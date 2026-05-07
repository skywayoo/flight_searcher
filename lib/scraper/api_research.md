# eztravel API Research Notes

## Confirmed working (via Playwright + page.evaluate)

These work after Playwright loads the homepage (which solves Incapsula JS challenge):

- `GET /www/api/flightAutoComplete?keyword={text}`
  Returns airport/city autocomplete. Example response:
  ```json
  {"status":200,"data":{"data":{"Data":[{"Code":"TPE","Country":"台灣","CountryCode":"TW","PoiName":"桃園國際機場","Type":3,"Datas":[{"Code":"TPE","Country":"台灣","CountryCode":"TW","PoiName":"台北","Type":5}]}],"Key":"桃園"}}}
  ```

- `GET /www/api/flightPopover`
  Returns full airport list grouped by region.

## Not yet found

- Search endpoint (need to successfully complete a UI search to capture)
- Result detail / booking URL pattern

## Approach

1. Playwright launches headless Chromium
2. Loads homepage → Incapsula JS challenge auto-solves (sets cookies)
3. Use `page.evaluate(async () => fetch(...))` to call API from page context (carries session cookies)
4. For search: still investigating the right endpoint + payload

## Current blockers

- Form filling via UI is unreliable: date picker repaints inputs mid-action
- Multiple "搜尋" buttons on page (cruise tab, flight tab); need to scope correctly
- Need ONE successful UI search to capture network call to find the search API endpoint

## Next steps

1. Use `page.locator('div[class*="flight"]').locator('button:has-text("搜尋")')` to scope to flight section
2. After capturing search API endpoint, switch to direct API calls
3. Multi-city search may use a different endpoint (need to test 多停留 tab)
