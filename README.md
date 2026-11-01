# MAH Digikala Extensions

**English** | [فارسی](README.fa.md)

A userscript that adds a few handy tools to [Digikala](https://www.digikala.com):

- **Table view for product listings.** On the Incredible Offers page and on category pages, a new header button opens every item in one full-page table that you can sort, group and filter, and export to CSV.
- **Dark mode.** A light / dark / system theme switch next to the notification bell, on every Digikala page (including the login and account pages).
- **Price comparison.** On product pages, a button that looks the product up on Torob, Emalls and BaSalam, and on Amazon and eBay with prices converted to Toman.

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

Go to the [Incredible Offers](https://www.digikala.com/incredible-offers/) page or any category page (addresses like `digikala.com/search/category-…`). A list button appears in the header, next to the bell. Click it to open the table.

- The first 1000 items load at once. Use **Load more** or **Load all** for the rest.
- Click a column header to sort by it.
- Group items by rating, discount percent, price range or discount amount.
- Combine several filters to narrow the list.
- **Export CSV** saves exactly what the table currently shows, ready to open in Excel.

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

## Permissions

When you install, Tampermonkey lists the sites the script may contact. They are used only for the price comparison and the exchange rate:

- `torob.com`, `emalls.ir`, `basalam.com`: Iranian price-comparison sites and marketplaces
- `amazon.com`, `amazon.ae`, `amazon.com.tr`, `amazon.de`, `ebay.com`: foreign shops
- `open.er-api.com`: currency exchange rates
- `google.com`: fallback search when a site returns no direct result

Settings (theme and exchange rate) are kept in your browser's local storage on digikala.com.

## Troubleshooting

- **No button appears:** make sure the script is enabled in Tampermonkey and reload the page. The table button only shows on Incredible Offers and category pages, and the comparison button only on product pages.
- **Chrome / Edge shows the script as installed but nothing happens:** see step 2 of the installation.
- **A price-comparison tab is empty or shows an error:** that site may have changed its layout, may be blocking the request, or may need a VPN or the opposite from your location. Try again later.

Something else broken? [Open an issue](https://github.com/H-MAli/mah-digikala-extensions/issues) with the page address and what you saw.

## Support the project

If the script is useful to you, you can buy me a coffee at **[coffeete.ir/hmali](https://www.coffeete.ir/hmali)**. Bug reports and ideas in [Issues](https://github.com/H-MAli/mah-digikala-extensions/issues) help just as much.

## License

[Apache License 2.0](LICENSE). You're free to use, modify and share the script, including in your own projects, as long as you credit the original author: keep the copyright notice and the contents of the [NOTICE](NOTICE) file with any copy or modified version, and mark the files you changed.

## Disclaimer

This project is not affiliated with or endorsed by Digikala or any of the other sites mentioned. Everything it shows is automatically generated information for your personal reference, not a claim about any shop, seller or product. It relies on how those sites work today, so a change on their side can break a feature until the script is updated.

**Please read the full [Disclaimer and methodology](DISCLAIMER.md) before using the script.** It explains exactly how every result is produced and what it does and doesn't mean.
