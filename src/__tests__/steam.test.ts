import { parsePriceOverview, parseSearchHtml, parseStoreSearch } from '../api/steam';

const ROW = (appid: number, title: string, final: number, discount: number) => `<a href="https://store.steampowered.com/app/${appid}/x/?snr=1" data-ds-appid="${appid}" data-ds-itemkey="App_${appid}" class="search_result_row ds_collapse_flag">
  <div class="col search_capsule"><img src="x.jpg"></div>
  <div class="responsive_search_name_combined">
    <div class="col search_name ellipsis"><span class="title">${title}</span></div>
    <div class="col search_released responsive_secondrow">Mar 3, 2023</div>
    <div class="col search_price_discount_combined responsive_secondrow" data-price-final="${final}">
      <div class="discount_block search_discount_block" data-price-final="${final}" data-bundlediscount="0" data-discount="${discount}">
        <div class="discount_pct">-${discount}%</div>
      </div>
    </div>
  </div>
</a>`;

describe('Steam search HTML', () => {
  it('extracts games, prices and discounts', () => {
    const html = ROW(1245620, 'ELDEN RING', 2399, 40) + ROW(413150, 'Stardew Valley &amp; Friends', 1049, 30);
    const games = parseSearchHtml(html, 'USD', 'US');
    expect(games).toHaveLength(2);
    expect(games[0]).toMatchObject({ key: 'steam:1245620', title: 'ELDEN RING', steamAppId: 1245620, platform: 'steam' });
    expect(games[0].listPrice?.sale).toEqual({ amount: 23.99, currency: 'USD' });
    expect(games[0].listPrice?.regular.amount).toBeCloseTo(39.98, 1);
    expect(games[0].listPrice?.discountPercent).toBe(40);
    expect(games[1].title).toBe('Stardew Valley & Friends');
    expect(games[0].releaseDate).toBe('Mar 3, 2023');
  });

  it('skips rows without an app id (bundles)', () => {
    const bundle = `<a href="https://store.steampowered.com/bundle/1/" data-ds-bundleid="1"><span class="title">Bundle</span></a>`;
    expect(parseSearchHtml(bundle, 'USD', 'US')).toHaveLength(0);
  });
});

describe('Steam store search', () => {
  it('maps apps and ignores other types', () => {
    const games = parseStoreSearch(
      {
        items: [
          { type: 'app', id: 1, name: 'Game One', price: { currency: 'EUR', initial: 2999, final: 1499 } },
          { type: 'sub', id: 2, name: 'A Package' },
          { type: 'app', id: 3, name: 'Free Game' },
        ],
      },
      'DE',
    );
    expect(games.map((g) => g.title)).toEqual(['Game One', 'Free Game']);
    expect(games[0].listPrice).toMatchObject({ country: 'DE', discountPercent: 50, sale: { amount: 14.99, currency: 'EUR' } });
    expect(games[1].listPrice).toBeUndefined();
  });
});

describe('Steam appdetails price_overview', () => {
  it('handles priced, free and failed apps', () => {
    const map = parsePriceOverview('BR', {
      '10': { success: true, data: { price_overview: { currency: 'BRL', initial: 9999, final: 4999, discount_percent: 50 } } },
      '20': { success: true, data: [] },
      '30': { success: false },
      '40': { success: true, data: { price_overview: { currency: 'BRL', initial: 2000, final: 2000 } } },
    });
    expect(map.size).toBe(2);
    expect(map.get(10)).toMatchObject({ country: 'BR', discountPercent: 50, sale: { amount: 49.99, currency: 'BRL' } });
    expect(map.get(40)?.sale).toBeUndefined();
  });
});
