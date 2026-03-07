// Copyright 2026 Achsah Systems
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#101A1D",
        mist: "#E5F0EF",
        tide: "#0F6C73",
        ember: "#E98133",
        sand: "#F6E8D2",
        slate: "#304347"
      },
      boxShadow: {
        panel: "0 24px 60px rgba(16, 26, 29, 0.16)"
      },
      fontFamily: {
        display: ["Avenir Next", "Trebuchet MS", "sans-serif"],
        body: ["IBM Plex Sans", "Segoe UI", "sans-serif"]
      }
    }
  },
  plugins: []
};

export default config;
