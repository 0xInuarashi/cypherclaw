---
name: pastebin
description: Create, read, and share Pastebin pastes. Use when the user wants to share text, code, or logs via a public URL, retrieve content from a pastebin.com link, or store output that is too large to display inline.
---

# Pastebin

## Creating a paste

Use the Pastebin API to POST content:

```bash
curl -s -X POST https://pastebin.com/api/api_post.php \
  -d "api_dev_key=$PASTEBIN_API_KEY" \
  -d "api_option=paste" \
  -d "api_paste_code=<content>" \
  -d "api_paste_name=<title>" \
  -d "api_paste_expire_date=1D"
```

A successful response is a URL: `https://pastebin.com/xxxxxxxx`

## Reading a paste

To fetch raw content from an existing paste URL, convert it to the raw form:

```
https://pastebin.com/xxxxxxxx  →  https://pastebin.com/raw/xxxxxxxx
```

Then fetch with:

```bash
curl -s https://pastebin.com/raw/xxxxxxxx
```

## Common options

| Parameter | Values | Notes |
|---|---|---|
| `api_paste_expire_date` | `N`, `10M`, `1H`, `1D`, `1W`, `2W`, `1M`, `6M`, `1Y` | `N` = never expires |
| `api_paste_private` | `0`, `1`, `2` | public, unlisted, private |
| `api_paste_format` | `text`, `python`, `bash`, `json`, … | syntax highlighting |

## When no API key is available

Guest pastes are allowed without authentication — omit `api_dev_key` and set `api_option=paste`. Guest pastes are always public and expire within 24 hours.

## Edge cases

- If the API returns `Bad API request`, the key is invalid or rate-limited.
- Maximum paste size is 512 KB.
- Private pastes (`api_paste_private=2`) require a paid account.
