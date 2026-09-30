from datetime import datetime, timezone
import gzip
import json
import os
import subprocess
import urllib.request


def run_curl(url, headers=None):
    cmd = ["curl.exe", "-s", "-L"]
    if headers:
        for h in headers:
            cmd.extend(["-H", h])
    cmd.append(url)

    try:
        res = subprocess.run(cmd, capture_output=True, timeout=30)
        if res.returncode == 0 and res.stdout:
            raw = res.stdout
            if raw.startswith(b"\x1f\x8b"):
                raw = gzip.decompress(raw)
            return json.loads(raw.decode("utf-8", errors="ignore"))
    except Exception:
        pass
    return None


def fetch_urllib(url):
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            raw = response.read()
            if raw.startswith(b"\x1f\x8b"):
                raw = gzip.decompress(raw)
            return json.loads(raw.decode("utf-8", errors="ignore"))
    except Exception:
        return None


def main():
    print("Fetching CS2 market prices...")
    prices = {}

    # Source 1: Skinport API (requires explicit gzip header and binary decompression)
    data = run_curl(
        "https://api.skinport.com/v1/items?app_id=730&currency=USD",
        headers=["Accept-Encoding: gzip", "Accept: application/json"],
    )
    if isinstance(data, list):
        for item in data:
            name = item.get("market_hash_name")
            val = item.get("suggested_price") or item.get("min_price")
            if name and val:
                prices[name] = round(float(val), 2)

    # Source 2: Market CSGO fallback
    if len(prices) < 1000:
        print("Using secondary market endpoint...")
        data = run_curl("https://market.csgo.com/api/v2/prices/USD.json")
        if not data:
            data = fetch_urllib("https://market.csgo.com/api/v2/prices/USD.json")

        if isinstance(data, dict) and "items" in data:
            for item in data["items"]:
                name = item.get("market_hash_name")
                val = item.get("price")
                if name and val and float(val) > 0:
                    prices[name] = round(float(val), 2)

    if not prices:
        print("Error: Could not retrieve price data from available sources.")
        return

    output_path = "prices.js"
    timestamp_iso = datetime.now(timezone.utc).isoformat()

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(f'window.PRICES_UPDATED_AT = "{timestamp_iso}";\n')
        f.write(
            "window.LOCAL_PRICES = "
            + json.dumps(prices, separators=(",", ":"))
            + ";"
        )

    mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"Done: {len(prices)} prices saved to {output_path} ({mb:.2f} MB).")


if __name__ == "__main__":
    main()