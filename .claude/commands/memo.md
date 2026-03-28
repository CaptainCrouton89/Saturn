Upload a voice memo or information dump to Saturn production.

## Input

$ARGUMENTS

The input can be:
- Plain text (a description or transcription of the memo)
- A file path (read the file contents)
- A URL or reference to pull content from

## Instructions

1. **Resolve the content**: If the input is a file path, read it. If it's a URL, fetch it. If it's plain text, use it directly.

2. **Determine source_type**: Pick the best fit from: `voice-memo`, `meeting`, `journal`, `book-summary`, `article`, `conversation`, `other`. Default to `voice-memo` if unclear.

3. **Upload to production** using admin key !`railway variables --kv -s api | grep ADMIN_API_KEY | cut -d= -f2-`:

```bash
curl -s -X POST https://saturn-backend-production.up.railway.app/api/information-dumps \
  -H 'Content-Type: application/json' \
  -H 'X-Admin-Key: <admin_key from above>' \
  -d "{\"content\": <JSON-escaped content>, \"source_type\": \"<type>\", \"user_id\": \"00000000-0000-0000-0000-000000000001\"}"
```

Use `python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))"` to JSON-escape content if needed.

4. **Report result**: Show the source_id and processing status from the response. If it fails, show the error.
