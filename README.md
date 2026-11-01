# MAH Digikala Extensions

**English** | [فارسی](README.fa.md)

A userscript that adds a few handy tools to [Digikala](https://www.digikala.com):

- **Table view for product listings.** On the Incredible Offers page and on category, search, brand and seller pages, a new header button opens every item in one full-page table that you can sort, group and filter, save as named views, and export to CSV.
- **Dark mode.** A light / dark / system theme switch next to the notification bell, on every Digikala page (including the login and account pages).
- **Price comparison.** On product pages, a button that looks the product up on Torob, Emalls and BaSalam, and on Amazon and eBay with prices converted to Toman.
- **Watchlist and price alerts.** Follow products and get an alert when their price drops, reaches your target, or they're back in stock.
- **Price history and discount check.** The script keeps its own record of prices in your browser, shows them on a chart alongside Digikala's own price chart, and compares a discounted price with the prices of the 30 days before the discount.

The script runs in your browser only. It has no server of its own and collects nothing. Like Digikala itself, its interface is in Persian; button names below are given in English for reference.

## Installation

1. Install the [Tampermonkey](https://www.tampermonkey.net/) extension for your browser (Chrome, Edge, Firefox, Safari or Opera).
2. **Chrome / Edge only:** userscripts need extra permission there. Open the extensions page (`chrome://extensions` or `edge://extensions`), then either turn on **Developer mode**, or open Tampermonkey's **Details** and turn on **Allow user scripts**, depending on your browser version.
3. Click this link: **[Install MAH Digikala Extensions](https://raw.githubusercontent.com/H-MAli/mah-digikala-extensions/main/mah-digikala.extensions.user.js)**
4. Tampermonkey opens an install page. Click **Install**.
5. Open or reload any Digikala page.

### Updates

Tampermonkey checks for new versions automatically. To check right away, open the Tampermonkey dashboard, select the script and choose **Check for updates**.

### Uninstall

Open the Tampermonkey dashboard and delete **MAH Digikala Extensions**.

## Usage

### Table view

Go to the [Incredible Offers](https://www.digikala.com/incredible-offers/) page, a category page (`digikala.com/search/category-…`), search results (`digikala.com/search/?q=…`), a brand page (`digikala.com/brand/…`) or a seller page (`digikala.com/seller/…`). A list button appears in the header, next to the bell. Click it to open the table. The table keeps the page's own filters and sort order.

- The first 1000 items load at once. Use **Load more** or **Load all** for the rest. Digikala serves at most 500 pages (10,000 items) of any list.
- Click a column header to sort by it.
- Group items by rating, discount percent, price range or discount amount.
- Combine several filters to narrow the list, including the quick filters **low stock only**, **Digikala delivery only** and **Jet only**.
- The panel next to the table lists every column; tick the ones you want to see, or use **All** / **Default**. The **Columns** button shows or hides the panel. Your choice is remembered. Besides the price columns there are:
  - **lowest price last month**: Digikala's own figure for the product's lowest price in the past month, as it reports it in its list data
  - **unit price**: per kilogram, litre or item, worked out from the size in the product's title. Sorting compares kilograms with kilograms and litres with litres.
  - **seller** and **seller rating**
  - **delivery**: from Digikala's warehouse, by Digikala or by the seller
  - **Jet** eligibility
  - **low stock**: "only N left", shown only when Digikala reports it
- **Views** saves the current sort order, grouping, filters and visible columns under a name, so you can bring them back in any table later. The search text isn't part of a view. Mark one view with ★ to make it the default; it's applied whenever a table opens.
- Items that Digikala marks as sponsored (سفارشی) carry the same label in the table. They can be hidden; see [Settings](#settings).
- **Export CSV** saves exactly what the table currently shows, ready to open in Excel.

### Quick filters

On the same listing pages, a **Quick filters** box sits inside Digikala's filter panel, at the top of its own scrolling list, so it stays at hand while you browse the products and scrolls out of the way with Digikala's filters. Pick filters as usual (a price range, "available only", fast delivery, a sort order and so on), give them a name and press **Save current filters**. From then on, one click applies that template on any listing page, in any category. For example, save "15 to 25 million" once and use it wherever you browse.

- Clicking the template that's already in use takes its filters off again.
- Filters that only exist in one category (the category's own attributes) are applied only in the category where you saved the template. Everything else carries over.
- Saving under an existing name replaces that template, and **×** removes one.
- The search text you typed is kept when you apply a template.

Below it, a **Display filters** box has a **Show discounted only** switch and a **Rating** range slider (0 to 5 by default). When both are set, a product has to match both; a product without a rating doesn't match a rating range. They hide the products that don't match on the page itself, so nothing changes in the page address or in Digikala's result count. They work on the products already loaded. In Digikala's newer scrolling feed, which lays products out in fixed rows, those products are dimmed rather than hidden so the rows don't break up; resting the pointer on one for a moment shows it in full. If none of the loaded products match, a note at the top of the list says so and has a button to clear the display filters; scrolling down may load more products. The display filters are remembered and apply on every listing page until you clear them.

On every page of the site, a round button in the bottom-right corner takes you back to the top once you've scrolled down.

### Theme

Click the sun / moon / monitor button next to the bell to cycle through **Light**, **Dark** and **System** (follows your operating system). Your choice is remembered.

### Price comparison

On a product page, click the price-comparison button. Results are shown in tabs:

| Tab | Source |
| --- | --- |
| Torob | torob.com |
| Emalls | emalls.ir |
| BaSalam | basalam.com |
| Foreign | Amazon (US, UAE, Turkey, Germany) and eBay |

Foreign prices are converted to Toman using a live exchange rate. You can set your own USD-to-Toman rate in that tab, and it is remembered.

> **Double-check every result.** Matches are found by searching for the product's name, so a result can be a different model, colour or capacity, especially in the Foreign tab. Converted prices are approximate and leave out shipping, customs and taxes.

### Price history and discount check

On a product page, a small **MAH** bar appears in the buy box with:

- the **discount check** result, when Digikala shows a discount. It answers two questions: is the price lower than the lowest price of the 30 days before the discount started, and was the "before discount" price actually charged during those days? The first time, a short notice explains what the check does and doesn't mean.
- a **price chart** button: Digikala's own daily history together with the script's records
- a **record price** button, when recording is set to manual

Digikala's own **نمودار قیمت** window also gets a section with the same check and your records.

In the table, a **discount check** column shows results for products already checked, and **Check discounts** checks up to 100 discounted products currently shown.

How often prices are recorded is set in the settings: manually, on each visit, or on a schedule (every 6 or 12 hours, daily, weekly). Records are kept for one year. See the [disclaimer and methodology](DISCLAIMER.md) for exactly how the check works.

### Watchlist and alerts

- Add a product with **☆ پیگیری قیمت** in the MAH bar on its page, or with the star next to its name in the table.
- On Digikala's [favourites page](https://www.digikala.com/profile/favorites/), **Add all to watchlist** copies all your favourites at once. Press it again later to add new ones.
- Open the list from the **MAH Digikala Ext.** entry in your profile menu. For each product it shows the latest price, a 3-month trend line, a target price you can set, a chart button and a check button.
- When recording is set to a schedule (every 6 or 12 hours, daily or weekly), the whole list is checked automatically while a Digikala tab is open, one product at a time. **Check now** works in every mode.
- Alerts: a price drop, reaching your target price, and back in stock. They appear as a message on the page and as a count on the menu entry, and optionally as desktop notifications.

Checks and alerts only happen while a Digikala tab is open. If you don't visit Digikala for a few days, there will be a gap.

### Settings

Open the settings panel from either place:

- the **MAH Digikala Ext.** entry in your Digikala profile menu (when logged in)
- the Tampermonkey toolbar menu on any Digikala page

In the panel you can:

- turn each feature (table, quick filters, theme, price comparison, price history) on or off
- choose how often prices are recorded, or delete all price records
- choose which watchlist alerts you get, and whether they also appear as desktop notifications
- choose which shops the price comparison searches
- hide the products Digikala marks as sponsored (سفارشی), both on its pages and in the table (off by default)
- set your own dollar rate
- switch between Persian and Latin digits
- export all of the script's data to a backup file, or restore it from one

The **About** tab has links to this page, bug reports, the disclaimer and donations.

## Permissions

When you install, Tampermonkey lists the sites the script may contact. They are used only for the price comparison and the exchange rate:

- `torob.com`, `emalls.ir`, `basalam.com`: Iranian price-comparison sites and marketplaces
- `amazon.com`, `amazon.ae`, `amazon.com.tr`, `amazon.de`, `ebay.com`: foreign shops
- `open.er-api.com`: currency exchange rates
- `google.com`: fallback search when a site returns no direct result

Settings and data are kept only in your browser, in Tampermonkey's own storage. Use **Export** in the settings panel to back them up.

## Troubleshooting

- **No button appears:** make sure the script is enabled in Tampermonkey and reload the page. The table button only shows on Incredible Offers, category, search, brand and seller pages, and the comparison button only on product pages.
- **Chrome / Edge shows the script as installed but nothing happens:** see step 2 of the installation.
- **A price-comparison tab is empty or shows an error:** that site may have changed its layout, may be blocking the request, or may need a VPN or the opposite from your location. Try again later.

Something else broken? [Open an issue](https://github.com/H-MAli/mah-digikala-extensions/issues) with the page address and what you saw.

## Support the project

If the script is useful to you, you can buy me a coffee at **[coffeete.ir/hmali](https://www.coffeete.ir/hmali)**. Bug reports and ideas in [Issues](https://github.com/H-MAli/mah-digikala-extensions/issues) help just as much.

## License

[PolyForm Noncommercial License 1.0.0](LICENSE). You're free to use, modify and share the script for any **noncommercial** purpose, such as personal use, study, hobby projects, or use by charities, schools and public bodies. Whenever you pass on a copy, changed or not, include the license and the "Required Notice" line that credits the original author (see [NOTICE](NOTICE)).

Commercial use, such as selling the script, bundling it into a paid product or using it to run a business, isn't allowed. If you'd like to use it commercially, contact me through my [GitHub profile](https://github.com/H-MAli).

## Disclaimer

This project is not affiliated with or endorsed by Digikala or any of the other sites mentioned. Everything it shows is automatically generated information for your personal reference, not a claim about any shop, seller or product. It relies on how those sites work today, so a change on their side can break a feature until the script is updated.

**Please read the full [Disclaimer and methodology](DISCLAIMER.md) before using the script.** It explains exactly how every result is produced and what it does and doesn't mean.
