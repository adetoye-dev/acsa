class Acsa < Formula
  desc "Local-first workflow automation engine from Achsah Systems"
  homepage "https://github.com/achsah-systems/acsa"
  url "https://github.com/achsah-systems/acsa/releases/download/v0.1.0/acsa-core-darwin-aarch64.tar.gz"
  version "0.1.0"
  sha256 "REPLACE_ON_RELEASE"
  license "Apache-2.0"

  depends_on "sqlite"

  def install
    bin.install "acsa-core"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/acsa-core --version")
  end
end
