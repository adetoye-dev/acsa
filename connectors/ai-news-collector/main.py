#!/usr/bin/env python3

import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

try:
    from defusedxml import ElementTree as SafeElementTree
except ImportError:
    SafeElementTree = ET

DEFAULT_RSS_SOURCES = [
    {"name": "OpenAI", "url": "https://openai.com/news/rss.xml"},
    {"name": "Anthropic", "url": "https://www.anthropic.com/news/rss.xml"},
    {"name": "Hugging Face", "url": "https://huggingface.co/blog/feed.xml"},
    {"name": "Google AI", "url": "https://blog.google/technology/ai/rss/"},
]
DEFAULT_HN = {
    "topstories_url": "https://hacker-news.firebaseio.com/v0/topstories.json",
    "item_url_template": "https://hacker-news.firebaseio.com/v0/item/{id}.json",
    "keywords": [
        "ai",
        "openai",
        "anthropic",
        "claude",
        "gpt",
        "llm",
        "model",
        "agent",
        "inference",
        "hugging face",
        "deepmind",
        "gemini",
        "reasoning",
    ],
    "max_matches": 6,
    "max_story_ids": 12,
}
SOURCE_WEIGHTS = {
    "openai": 16,
    "anthropic": 16,
    "google ai": 14,
    "hugging face": 13,
    "hacker news": 10,
}
CATEGORY_RULES = {
    "models": ["model", "gpt", "claude", "gemini", "llm", "weights", "multimodal"],
    "tooling": ["sdk", "tool", "cli", "agent", "api", "framework", "developer"],
    "research": ["research", "paper", "benchmark", "study", "eval", "alignment"],
    "product": ["release", "launch", "available", "pricing", "subscription", "workspace"],
    "infrastructure": ["inference", "gpu", "training", "serve", "deployment", "latency"],
}
IMPACT_KEYWORDS = {
    "launch": 5,
    "released": 5,
    "release": 5,
    "introducing": 4,
    "available": 4,
    "open-source": 4,
    "opensourced": 4,
    "benchmark": 3,
    "reasoning": 3,
    "agent": 3,
    "developer": 2,
    "api": 2,
    "tooling": 2,
    "model": 2,
}
ELLIPSIS = "..."
XML_DANGEROUS_DECLARATION = re.compile(r"<!\s*(DOCTYPE|ENTITY)\b", re.IGNORECASE)


def load_payload() -> dict:
    try:
        return json.load(sys.stdin)
    except json.JSONDecodeError as error:
        raise SystemExit(f"invalid connector payload: {error}")


def strip_html(value: str) -> str:
    value = re.sub(r"<[^>]+>", " ", value or "")
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def compact(value: str, limit: int = 320) -> str:
    text = strip_html(value)
    if len(text) <= limit:
        return text
    if limit <= len(ELLIPSIS):
        return ELLIPSIS[:limit]
    return text[: limit - len(ELLIPSIS)].rstrip() + ELLIPSIS


def resolve_fixture_path(fixture_path: str, connector_dir: Path) -> Path:
    relative_path = Path(fixture_path)
    if relative_path.is_absolute():
        raise ValueError(f"fixture_path must be relative to {connector_dir}; got {fixture_path!r}")

    resolved_connector_dir = connector_dir.resolve()
    resolved_fixture = (connector_dir / relative_path).resolve()
    try:
        resolved_fixture.relative_to(resolved_connector_dir)
    except ValueError as error:
        raise ValueError(
            f"fixture_path must stay inside {resolved_connector_dir}; got {fixture_path!r}"
        ) from error
    if not resolved_fixture.exists() or not resolved_fixture.is_file():
        raise ValueError(f"fixture_path does not point to a readable file: {fixture_path!r}")
    return resolved_fixture


def safe_xml_fromstring(xml_text: str) -> ET.Element:
    if XML_DANGEROUS_DECLARATION.search(xml_text):
        raise ValueError("xml payload contains forbidden DTD or entity declarations")
    return SafeElementTree.fromstring(xml_text)


def normalize_published_at(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        timestamp = float(value)
    elif isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return ""
        if not re.fullmatch(r"\d+(?:\.\d+)?", stripped):
            return stripped
        timestamp = float(stripped)
    else:
        return str(value).strip()

    try:
        return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat().replace("+00:00", "Z")
    except (OverflowError, OSError, ValueError):
        return str(value).strip()


def load_text(source: dict, timeout_secs: int, connector_dir: Path) -> str:
    if source.get("fixture_path"):
        fixture = resolve_fixture_path(str(source["fixture_path"]), connector_dir)
        return fixture.read_text(encoding="utf-8")

    url = source.get("url")
    if not url:
        raise RuntimeError("source is missing url")

    request = urllib.request.Request(
        url,
        headers={"User-Agent": "Acsa AI News Demo/1.0 (+https://github.com/achsah-systems/acsa)"},
    )
    with urllib.request.urlopen(request, timeout=timeout_secs) as response:
        return response.read().decode("utf-8", errors="replace")


def first_text(element: ET.Element, names: list[str]) -> str:
    for name in names:
        found = element.findtext(name)
        if found and found.strip():
            return found.strip()
    return ""


def atom_link(entry: ET.Element) -> str:
    for link in entry.findall("{http://www.w3.org/2005/Atom}link"):
        href = link.attrib.get("href", "").strip()
        if href:
            return href
    for link in entry.findall("link"):
        href = link.attrib.get("href", "").strip()
        if href:
            return href
    return ""


def clean_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url.strip())
    if not parsed.scheme or not parsed.netloc:
        return url.strip()
    filtered_query = [
        (key, value)
        for key, value in urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
        if not key.lower().startswith("utm_")
    ]
    return urllib.parse.urlunparse(
        (
            parsed.scheme,
            parsed.netloc,
            parsed.path.rstrip("/") or parsed.path,
            parsed.params,
            urllib.parse.urlencode(filtered_query),
            "",
        )
    )


def parse_feed(source_name: str, xml_text: str, limit: int) -> list[dict]:
    root = safe_xml_fromstring(xml_text)
    items: list[dict] = []

    if root.tag.endswith("rss") or root.find("channel") is not None:
        entries = root.findall("./channel/item")
        for entry in entries[:limit]:
            title = first_text(entry, ["title"])
            url = first_text(entry, ["link"])
            summary = first_text(entry, ["description", "summary"])
            published = first_text(entry, ["pubDate", "updated", "published"])
            if title and url:
                items.append(
                    {
                        "published_at": published,
                        "source_name": source_name,
                        "source_type": "rss",
                        "summary": compact(summary),
                        "title": strip_html(title),
                        "url": clean_url(url),
                    }
                )
        return items

    entries = root.findall("{http://www.w3.org/2005/Atom}entry") or root.findall("entry")
    for entry in entries[:limit]:
        title = first_text(entry, ["{http://www.w3.org/2005/Atom}title", "title"])
        url = atom_link(entry)
        summary = first_text(
            entry,
            [
                "{http://www.w3.org/2005/Atom}summary",
                "{http://www.w3.org/2005/Atom}content",
                "summary",
                "content",
            ],
        )
        published = first_text(
            entry,
            [
                "{http://www.w3.org/2005/Atom}updated",
                "{http://www.w3.org/2005/Atom}published",
                "updated",
                "published",
            ],
        )
        if title and url:
            items.append(
                {
                    "published_at": published,
                    "source_name": source_name,
                    "source_type": "rss",
                    "summary": compact(summary),
                    "title": strip_html(title),
                    "url": clean_url(url),
                }
            )
    return items


def load_rss_source(source: dict, timeout_secs: int, connector_dir: Path, limit: int) -> tuple[dict, list[dict]]:
    items = parse_feed(source.get("name", "RSS"), load_text(source, timeout_secs, connector_dir), limit)
    return (
        {
            "error": None,
            "item_count": len(items),
            "name": source.get("name", "RSS"),
            "status": "ok",
            "type": "rss",
        },
        items,
    )


def load_hn_items(config: dict, timeout_secs: int, connector_dir: Path) -> list[dict]:
    if config.get("fixture_path"):
        fixture = resolve_fixture_path(str(config["fixture_path"]), connector_dir)
        data = json.loads(fixture.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data
        raise RuntimeError("hn fixture must be a JSON array of item objects")

    topstories_url = config.get("topstories_url", DEFAULT_HN["topstories_url"])
    item_url_template = config.get("item_url_template", DEFAULT_HN["item_url_template"])
    story_ids = json.loads(load_text({"url": topstories_url}, timeout_secs, connector_dir))
    items = []
    selected_ids = story_ids[: int(config.get("max_story_ids", DEFAULT_HN["max_story_ids"]))]
    max_workers = max(1, min(int(config.get("max_workers", 6)), len(selected_ids) or 1))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(
                load_text,
                {"url": item_url_template.format(id=story_id)},
                timeout_secs,
                connector_dir,
            ): story_id
            for story_id in selected_ids
        }
        for future in as_completed(futures):
            try:
                raw = future.result()
            except urllib.error.URLError:
                continue
            except Exception:
                continue
            try:
                item = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if isinstance(item, dict):
                items.append(item)
    return items


def matches_keywords(text: str, keywords: list[str]) -> bool:
    haystack = text.lower()
    if "not ai" in haystack or "non-ai" in haystack or "not related to ai" in haystack:
        return False
    return any(keyword.lower() in haystack for keyword in keywords)


def classify_item(text: str) -> str:
    lowered = text.lower()
    for category, keywords in CATEGORY_RULES.items():
        if any(keyword in lowered for keyword in keywords):
            return category
    return "general"


def score_item(item: dict) -> int:
    source_weight = SOURCE_WEIGHTS.get(item.get("source_name", "").lower(), 8)
    text = f"{item.get('title', '')} {item.get('summary', '')}".lower()
    keyword_score = sum(weight for keyword, weight in IMPACT_KEYWORDS.items() if keyword in text)
    hn_score = min(int(item.get("hn_points", 0) / 25), 6) + min(int(item.get("hn_comments", 0) / 12), 4)
    return source_weight + keyword_score + hn_score


def normalize_hn_items(raw_items: list[dict], keywords: list[str], limit: int) -> list[dict]:
    items: list[dict] = []
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        title = strip_html(str(raw.get("title", "")).strip())
        url = clean_url(str(raw.get("url", "")).strip())
        text = compact(str(raw.get("text", "")).strip())
        if not title:
            continue
        searchable = " ".join(part for part in (title, text, url) if part)
        if not matches_keywords(searchable, keywords):
            continue
        items.append(
            {
                "published_at": normalize_published_at(raw.get("time", "")),
                "source_name": "Hacker News",
                "source_type": "hn",
                "summary": text,
                "title": title,
                "url": url or f"https://news.ycombinator.com/item?id={raw.get('id', '')}",
                "hn_comments": int(raw.get("descendants", 0) or 0),
                "hn_points": int(raw.get("score", 0) or 0),
            }
        )
        if len(items) >= limit:
            break
    return items


def dedupe_and_rank(items: list[dict], max_ranked_items: int) -> list[dict]:
    seen: set[str] = set()
    ranked: list[dict] = []
    for item in items:
        dedupe_key = clean_url(item.get("url", "")) or re.sub(r"\W+", "", item.get("title", "").lower())
        if not dedupe_key or dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        text = f"{item.get('title', '')} {item.get('summary', '')}"
        item["category"] = classify_item(text)
        item["impact_score"] = score_item(item)
        ranked.append(item)
    ranked.sort(key=lambda item: (item.get("impact_score", 0), item.get("source_name", "")), reverse=True)
    return ranked[:max_ranked_items]


def build_prompt(product_name: str, generated_at: str, ranked_items: list[dict], source_results: list[dict]) -> str:
    coverage = []
    for source in source_results:
        if source.get("status") == "ok":
            coverage.append(f"- {source['name']}: {source['item_count']} item(s)")
        else:
            coverage.append(f"- {source['name']}: failed ({source['error']})")

    if not ranked_items:
        return (
            f"You are writing the {product_name} AI news intelligence brief for {generated_at}.\n"
            "The source fetches completed, but there were no strong AI updates worth highlighting.\n"
            "Return concise markdown with the sections: Top developments today, Why they matter, "
            "Signals worth watching, Suggested experiments or follow-ups, Source links.\n"
            "Be explicit that it was a quiet day while still sounding useful.\n\n"
            "Source coverage:\n"
            + "\n".join(coverage)
        )

    lines = []
    for index, item in enumerate(ranked_items, start=1):
        lines.append(
            f"{index}. [{item['source_name']}] {item['title']}\n"
            f"   category: {item['category']}\n"
            f"   impact_score: {item['impact_score']}\n"
            f"   summary: {item.get('summary', '') or 'No summary provided.'}\n"
            f"   link: {item['url']}"
        )

    return (
        f"You are writing the {product_name} AI news intelligence brief for {generated_at}.\n"
        "Return concise, high-signal markdown for developers and builders.\n"
        "Use exactly these sections: Top developments today, Why they matter, Signals worth watching, "
        "Suggested experiments or follow-ups, Source links.\n"
        "Do not invent facts beyond the source items below.\n\n"
        "Source coverage:\n"
        + "\n".join(coverage)
        + "\n\nRanked items:\n"
        + "\n".join(lines)
    )


def main() -> None:
    payload = load_payload()
    params = payload.get("params", {}) or {}
    connector_dir = Path(__file__).resolve().parent

    rss_sources = params.get("rss_sources") or DEFAULT_RSS_SOURCES
    hn_config = params.get("hn") or DEFAULT_HN
    product_name = params.get("product_name", "Acsa")
    timeout_secs = int(params.get("timeout_secs", 8))
    max_feed_items = int(params.get("max_feed_items_per_source", 4))
    max_ranked_items = int(params.get("max_ranked_items", 8))
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    source_results: list[dict] = []
    collected_items: list[dict] = []

    rss_workers = max(1, min(len(rss_sources), 4))
    with ThreadPoolExecutor(max_workers=rss_workers) as executor:
        futures = {
            executor.submit(load_rss_source, source, timeout_secs, connector_dir, max_feed_items): source
            for source in rss_sources
        }
        for future in as_completed(futures):
            source = futures[future]
            try:
                result, items = future.result()
                collected_items.extend(items)
                source_results.append(result)
            except Exception as error:
                source_results.append(
                    {
                        "error": str(error),
                        "item_count": 0,
                        "name": source.get("name", "RSS"),
                        "status": "failed",
                        "type": "rss",
                    }
                )

    try:
        hn_items = normalize_hn_items(
            load_hn_items(hn_config, timeout_secs, connector_dir),
            list(hn_config.get("keywords", DEFAULT_HN["keywords"])),
            int(hn_config.get("max_matches", DEFAULT_HN["max_matches"])),
        )
        collected_items.extend(hn_items)
        source_results.append(
            {
                "error": None,
                "item_count": len(hn_items),
                "name": "Hacker News",
                "status": "ok",
                "type": "hn",
            }
        )
    except Exception as error:
        source_results.append(
            {
                "error": str(error),
                "item_count": 0,
                "name": "Hacker News",
                "status": "failed",
                "type": "hn",
            }
        )

    sources_succeeded = sum(1 for source in source_results if source["status"] == "ok")
    sources_failed = sum(1 for source in source_results if source["status"] != "ok")
    if sources_succeeded == 0:
        raise SystemExit("all AI news sources failed; no brief could be generated")

    ranked_items = dedupe_and_rank(collected_items, max_ranked_items)
    prompt = build_prompt(product_name, generated_at, ranked_items, source_results)
    subject_hint = ranked_items[0]["title"] if ranked_items else "Quiet AI news day"

    json.dump(
        {
            "generated_at": generated_at,
            "item_count": len(ranked_items),
            "prompt": prompt,
            "quiet_day": len(ranked_items) == 0,
            "ranked_items": ranked_items,
            "source_results": source_results,
            "sources_failed": sources_failed,
            "sources_succeeded": sources_succeeded,
            "subject_hint": subject_hint,
        },
        sys.stdout,
    )


if __name__ == "__main__":
    main()
