# Disclaimer and methodology

**English** | [فارسی](DISCLAIMER.fa.md)

Please read this before using MAH Digikala Extensions ("the script"). By installing or using the script you accept the terms below.

## 1. Independent project

- The script is an independent, unofficial, free and open-source project by a single developer.
- It is **not affiliated with, endorsed by, sponsored by or connected to** Digikala (دیجی‌کالا) or any of the other websites it mentions or contacts, including Torob, Emalls, BaSalam, Amazon, eBay, Google and open.er-api.com.
- "Digikala" and all other names, logos and trademarks belong to their respective owners. They are used only to describe what the script works with.

## 2. Information only, no claims about anyone

Everything the script shows is **automatically generated information for the user's personal reference**. This includes tables, price histories, discount checks, unit prices, price comparisons and exchange-rate conversions.

- It is **not** a statement of fact, an accusation or a judgement about Digikala, any seller, any brand or any product.
- In particular, a discount-check result describes only how one price compares with other prices in the data the script had at that moment. It does **not** say that any discount is false, misleading or unlawful. It says nothing about anyone's intent.
- Results can be wrong for many reasons, listed in section 5. **Always check prices, product details and offers on the seller's own page before you decide anything.**
- Nothing the script shows is financial, legal or purchasing advice.

## 3. No warranty, no liability

- The script is provided **"as is", without warranty of any kind**, as stated in the [Apache License 2.0](LICENSE).
- The author is **not responsible** for any loss, damage, cost or claim that results from using the script or relying on what it shows. This covers purchases made or not made, incorrect prices or matches, missed alerts, data loss, and any action a website takes on the user's account or connection.
- You use the script at your own risk.

## 4. Methodology

This section describes exactly how the script produces each piece of information, so anyone can see what a result does and doesn't mean.

### 4.1 Where the data comes from

- **Digikala product and list data.** The script reads it from the same public endpoints Digikala's own pages use (`api.digikala.com`), requested from the user's own browser tab on www.digikala.com. It never uses anyone else's account, and it doesn't send the user's login or cookies to any other website.
- **Digikala's price chart.** This is the daily price history Digikala itself publishes in its "نمودار قیمت" (price chart) window. For each day it has a selling price, a reference ("before discount") price and whether the product was available. The script shows this data as published and doesn't change it.
- **The script's own price records.** The script saves a record when the user opens a product page, and when it checks a product on the user's watchlist on the schedule the user picked in settings. Each record holds:
  - the date and time
  - the selling price
  - the reference price, if any
  - whether the product was available
  - the US dollar to Toman exchange rate for that day (kept once per day for all records of that day)
- **Exchange rates** come from open.er-api.com, unless the user enters their own rate. Rates are approximate and may differ from Iran's open-market rate.
- **Price comparison** results come from public search pages and endpoints of the listed sites, searched by the product's name.

### 4.2 How often the script contacts websites

- It sends requests only while the user has a Digikala tab open, and only for pages the user opens or products the user has added to the watchlist.
- Watchlist checks run one product at a time, about 1.5 seconds apart, at the frequency the user chose (default: once a day).
- The table view loads list pages the same way Digikala's own infinite scroll does, when the user opens the table or asks for more items.
- When the user presses **Add all to watchlist** on Digikala's favourites page, the script reads the user's favourites list from Digikala, page by page, in the user's own logged-in browser tab. Nothing about the list leaves the browser.
- In the table, **Check discounts** fetches the price history of at most 100 products per press, one at a time, about 1.5 seconds apart. Results are kept for one day.

### 4.3 Discount check

The discount check runs only when Digikala shows a discount for a product: a selling price below a reference price. It runs two tests and shows the result of each:

1. **Compared with the 30-day lowest price.**
   - The "discount start" is the first day of the current unbroken run of days on which the product showed a discount. Days on which the product was out of stock don't interrupt the run. Up to 3 days in a row without data are tolerated; a longer gap ends it.
   - The script finds the lowest selling price on days the product was available, during the 30 days before the discount start.
   - Result: the current selling price is either **"lower than the 30-day lowest price"** or **"not lower than the 30-day lowest price"**.
2. **Reference price seen as a selling price.**
   - The script checks whether the reference price shown with the discount was the actual selling price on at least one day during those same 30 days.
   - Result: **"reference price seen as a selling price"** or **"reference price not seen as a selling price in the last 30 days"**.

The rules behind both tests:

- **Data used.** Digikala's own daily history comes first. The script's own records fill days that Digikala's data doesn't cover.
- **Days that don't count.** Days with no data, and days on which the product wasn't available, are left out.
- **Not enough data.** If fewer than 7 days of usable data exist in the 30-day window, the result is **"not enough data"** and no test result is shown.
- **Rounding.** Prices are compared in Toman. Differences under 1% count as equal, to allow for rounding.

This follows the approach many consumer-protection rules use for sale prices (for example the EU's rule on announcing price reductions). It is used here only as a neutral yardstick: the script doesn't claim that any such rule applies.

### 4.4 Price-drop and back-in-stock alerts

- An alert compares the newest price the script recorded for a watchlist product with the price recorded before it: a **price drop** when it is lower, **back in stock** when the product was unavailable before and is available now.
- A target price set by the user is compared with the newest recorded price.
- Alerts can be late or missed if the browser was closed or a check failed.

### 4.5 Unit price

- The unit price (per kilogram, litre or item) comes from sizes written in the product's title, for example "۵۰۰ گرم" or "بسته ۶ عددی", divided into the selling price.
- When the title is unclear, nothing is shown.
- Titles can be wrong or ambiguous, so the unit price can be wrong too.

### 4.6 Price comparison with other shops

- Other shops are searched by the product's name, so **results can belong to a different product, model, colour or capacity**.
- Foreign prices are converted at an approximate exchange rate and don't include shipping, customs or taxes.

### 4.7 Hiding sponsored items

When the user turns this on, the script hides items that Digikala itself marks as sponsored or advertised. It doesn't judge any item on its own.

## 5. Known limitations

Results can be incomplete or wrong, for example because:

- **Gaps in the data.** The script only records while a Digikala tab is open, and Digikala's own history may be incomplete, aggregated or revised.
- **Different variants and sellers.** One product page can have different variants (colour, size, warranty) and sellers with different prices, and the data may not separate them.
- **Website changes.** Digikala and the other sites can change how they work at any time, which can break or distort any feature until the script is updated.
- **Inflation and exchange rates.** Prices in Iran can change quickly, so a price may be "not lower" than an earlier one for reasons unrelated to the discount.
- **Bugs.** The script itself can have errors.

## 6. Privacy

- Everything the script stores is kept **only in the user's own browser**, in the userscript manager's storage. That includes settings, the watchlist, price records and saved views.
- Nothing is sent to the author or to any server run by the author. The script has no analytics or tracking.
- The only network requests it makes are the ones described in section 4.

## 7. Responsibility of the user

Users are responsible for making sure their use of the script is lawful where they live, and that it complies with the terms of the websites they visit.

## 8. Corrections and removal requests

If you believe something the script does or shows is inaccurate, unfair or infringes your rights, please [open an issue](https://github.com/H-MAli/mah-digikala-extensions/issues), or contact the author privately through the contact details on the [author's GitHub profile](https://github.com/H-MAli). This applies to Digikala, a seller, a brand or anyone else. The author will review such requests in good faith and, where justified, correct, change or remove the feature concerned.
