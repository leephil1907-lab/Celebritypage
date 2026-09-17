/**
 * server/i18n.js — JA primary, EN secondary. Server-rendered strings, so both languages work with JS off.
 */
const DICT = {
  'nav.home': ['HOME', 'HOME'],
  'nav.work': ['WORK', 'WORK'],
  'nav.music': ['MUSIC', 'MUSIC'],
  'nav.tour': ['TOUR', 'TOUR'],
  'nav.journal': ['JOURNAL', 'JOURNAL'],
  'nav.archive': ['ARCHIVE', 'ARCHIVE'],
  'nav.members': ['MEMBERS', 'MEMBERS'],
  'nav.shop': ['SHOP', 'SHOP'],
  'nav.search': ['SEARCH', 'SEARCH'],
  'nav.join': ['JOIN', 'JOIN'],
  'nav.support': ['SUPPORT', 'SUPPORT'],
  'cta.login': ['ログイン', 'Login'],
  'cta.signup': ['新規登録', 'Sign Up'],
  'cta.logout': ['ログアウト', 'Logout'],
  'cta.dashboard': ['ダッシュボード', 'Dashboard'],
  'cta.book': ['予約する', 'Book'],
  'cta.details': ['詳細を見る', 'Details'],
  'cta.viewAll': ['すべて見る', 'View All'],
  'cta.addToCart': ['カートに追加', 'Add to Cart'],
  'cta.purchase': ['ファンカード購入', 'Purchase Fan Card'],
  'cta.join': ['メンバーになる', 'Become a Member'],
  'sec.about': ['アーティスト', 'Artist'],
  'sec.membership': ['ファンクラブ', 'Fan Club Membership'],
  'sec.vault': ['限定アーカイブ', 'Exclusive Vault'],
  'sec.booking': ['ブッキング', 'Booking'],
  'sec.news': ['ニュース', 'News'],
  'sec.schedule': ['スケジュール', 'Schedule'],
  'sec.regular': ['レギュラー', 'Regular'],
  'sec.cm': ['CM', 'CM'],
  'sec.film': ['フィルモグラフィ', 'Filmography'],
  'sec.release': ['リリース', 'Release'],
  'sec.shop': ['ショップ', 'Official Shop'],
  'sec.journal': ['ジャーナル', 'Journal'],
  'sec.archive': ['アーカイブ', 'Archive'],
  'sec.tour': ['コンサート/ステージ', 'Concert / Stage'],
  'sec.passport': ['ツアーパスポート', 'Tour Passport'],
  'lbl.member': ['会員', 'Member'],
  'lbl.tier': ['ティア', 'Tier'],
  'lbl.valid': ['有効期限', 'Valid'],
  'lbl.tickets': ['チケット', 'Tickets'],
  'lbl.cart': ['カート', 'Cart'],
  'lbl.stock': ['在庫', 'Stock'],
  'lbl.soldout': ['売り切れ', 'Sold out'],
  'lbl.lowstock': ['残りわずか', 'Low stock'],
  'lbl.nextUp': ['次回', 'Next Up'],
  'lbl.share': ['シェア', 'Share'],
  'lbl.related': ['関連リンク', 'Related Sites'],
  'msg.nocard': ['ファンカード未取得 — ティアを選んで解除', 'No active Fan Card — choose a tier to unlock.'],
  'msg.vaultok': ['ボルト解除済み', 'Vault unlocked'],
  'msg.empty': ['まだ項目がありません', 'Nothing here yet'],
  'msg.search': ['キーワードを入力してください', 'Type a keyword to search'],
};

export const LANGS = ['ja', 'en'];
export function t(lang, key) {
  const pair = DICT[key];
  if (!pair) return key;
  return lang === 'en' ? pair[1] : pair[0];
}
export function translator(lang) {
  return (key) => t(lang, key);
}
export const dict = DICT;
