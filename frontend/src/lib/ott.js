/* The OTT streaming template (Templates → Apps): no code in the app. A workflow builds the catalogue (it
   fetches the video files with an HTTP request, then a Code node turns them into titles, live matches and
   plans), and the app is made in the Visual builder: pages of components bound to that data. */

export const OTT_CATALOGUE = String.raw`// STEP 2 of the workflow. The HTTP request fetched the video files (each file is one item).
// Here they become the whole streaming catalogue, one item each: titles (movies, shows, sports),
// live matches and plans. The app filters them by "kind" and by "rows" (which home-screen rows a
// title is in). Swap this for your own CMS, a Google Sheet or a database: keep the same fields.
const files = items.filter(v => v.src);
const play = i => (files.length ? files[i % files.length].src : '');
const img = (seed, w, h) => 'https://picsum.photos/seed/starplay-' + seed + '/' + w + '/' + h;
const icon = name => 'https://storage.googleapis.com/shaka-asset-icons/' + name + '.png';

// id, title, kind, genres, language, year, age rating, length or seasons, score, about, rows, artwork
const LIST = [
  ['code-red', 'Code Red: Delhi', 'Show', 'Crime|Thriller', 'Hindi', 2025, 'A', '2 Seasons', 8.7, 'A cyber-crime cell races a hacker who can switch off the capital one street at a time.', 'spotlight|continue|top10|latest|popular|thriller'],
  ['monsoon', 'The Last Monsoon', 'Movie', 'Drama|Romance', 'Hindi', 2025, 'U/A 13+', '2h 18m', 8.1, 'Two strangers stranded in a hill town wait out the year’s last monsoon, and their pasts.', 'spotlight|continue|top10|latest'],
  ['kingdom', 'Kingdom of Sand', 'Movie', 'Action|Historical', 'Hindi', 2024, 'U/A 16+', '2h 41m', 7.9, 'A desert queen defends her fort against an empire with ten times her army.', 'spotlight|blockbuster'],
  ['mumbai-nights', 'Mumbai Nights', 'Show', 'Drama|Music', 'Hindi', 2024, 'U/A 16+', '3 Seasons', 8.3, 'A jazz club in Colaba, three generations of musicians, and the city that never sleeps.', 'spotlight|top10|popular'],
  ['sintel', 'Sintel', 'Movie', 'Fantasy|Adventure', 'English', 2010, 'U/A 13+', '15m', 8.4, 'A lonely young woman crosses frozen mountains to find the baby dragon she once raised.', 'spotlight|continue|top10|blockbuster', icon('sintel')],
  ['hostel', 'The Hostel Diaries', 'Show', 'Comedy|Youth', 'Hindi', 2023, 'U/A 13+', '2 Seasons', 8.9, 'Six first-years, one broken geyser and the best four years of their lives.', 'continue|top10|popular'],
  ['steel', 'Tears of Steel', 'Movie', 'Sci-Fi|Action', 'English', 2012, 'U/A 13+', '12m', 7.6, 'In a future Amsterdam, scientists try to rewrite the night the robots won.', 'blockbuster', icon('tears_of_steel')],
  ['neon', 'Neon Bazaar', 'Movie', 'Thriller|Mystery', 'Hindi', 2025, 'A', '2h 05m', 7.8, 'A night-market photographer captures a murder in the background of a selfie.', 'latest|thriller'],
  ['bunny', 'Big Buck Bunny', 'Movie', 'Animation|Kids|Comedy', 'English', 2008, 'U', '10m', 8.0, 'A gentle giant rabbit gets his own back on three bullying rodents.', 'kids', icon('big_buck_bunny')],
  ['kaveri', 'Kaveri Blues', 'Movie', 'Drama|Family', 'Tamil', 2024, 'U', '2h 12m', 8.2, 'A retired boatman teaches his city-born granddaughter the river’s old songs.', 'top10|blockbuster'],
  ['highway', 'Highway 44', 'Show', 'Thriller|Road', 'Hindi', 2025, 'A', '1 Season', 8.0, 'A truck driver from Srinagar to Kanyakumari realises his cargo is being followed.', 'latest|popular|thriller'],
  ['kochi', 'Thunder Over Kochi', 'Movie', 'Action|Thriller', 'Malayalam', 2025, 'U/A 16+', '2h 26m', 7.7, 'A harbour pilot must bring a hijacked ship into port before the storm does.', 'latest|thriller|blockbuster'],
  ['mirchi', 'Mirchi Masala', 'Movie', 'Comedy|Family', 'Telugu', 2023, 'U', '2h 09m', 7.4, 'Two rival pickle shops, one wedding, and a secret family recipe.', 'blockbuster'],
  ['royal', 'Royal Court', 'Show', 'Political|Drama', 'Hindi', 2024, 'U/A 16+', '2 Seasons', 8.5, 'A princely state’s last heir becomes its first elected chief minister.', 'top10|popular'],
  ['ghat', 'The Silent Ghat', 'Movie', 'Mystery|Horror', 'Bengali', 2024, 'A', '1h 58m', 7.5, 'Every winter, one boat on the Hooghly comes back with no one aboard.', 'thriller'],
  ['startup', 'Startup Gully', 'Show', 'Comedy|Business', 'Hindi', 2025, 'U/A 13+', '1 Season', 8.6, 'Four friends, one jugaad app and a lot of very confused investors.', 'top10|latest|popular'],
  ['orbit', 'Orbit 9', 'Movie', 'Sci-Fi|Drama', 'English', 2025, 'U/A 13+', '2h 02m', 7.9, 'The crew of a failing space station has nine orbits to agree who goes home.', 'latest'],
  ['angel', 'Angel One', 'Movie', 'Drama|Short', 'English', 2015, 'U/A 13+', '1m', 7.0, 'A short scene, streamed in HLS with five audio languages and subtitles.', '', icon('angel_one')],
  ['kitchen', 'Ice & Fire Kitchen', 'Show', 'Reality|Food', 'English', 2024, 'U', '4 Seasons', 7.8, 'Home cooks from the Himalayas and the coast battle it out, one region a week.', 'popular'],
  ['paper-boats', 'Paper Boats', 'Movie', 'Family|Drama', 'Marathi', 2023, 'U', '1h 49m', 8.3, 'A boy in a fishing village builds a boat to find his father’s lost trawler.', 'top10|kids'],
  ['archivists', 'The Archivists', 'Show', 'Mystery|Sci-Fi', 'English', 2025, 'U/A 16+', '1 Season', 8.4, 'Librarians who can step into old photographs, and the one picture they must not enter.', 'latest|popular'],
  ['rangers', 'Little Rangers', 'Show', 'Animation|Kids', 'Hindi', 2024, 'U', '3 Seasons', 8.1, 'Three cubs and a very patient elephant look after the jungle.', 'kids'],
  ['space-kids', 'Space Kids Club', 'Show', 'Animation|Kids|Sci-Fi', 'English', 2025, 'U', '2 Seasons', 7.9, 'A school club builds a rocket out of recycled tiffin boxes.', 'kids'],
  ['tigers', 'Tigers of the Teak Forest', 'Movie', 'Documentary|Nature', 'Hindi', 2024, 'U', '52m', 8.8, 'A year in the life of a tigress raising four cubs.', 'docs|top10'],
  ['rivers', 'Rivers of India', 'Show', 'Documentary|Travel', 'Hindi', 2023, 'U', '1 Season', 8.5, 'From glacier to delta: eight rivers and the people who live by them.', 'docs'],
  ['kabaddi', 'Kabaddi League: Finals', 'Sports', 'Sports|Kabaddi', 'Hindi', 2025, 'U', '2h 30m', 8.0, 'Full replay of the final, with the raid that won it in the last 10 seconds.', 'replays'],
  ['pattern', 'Test Pattern Live', 'Movie', 'Tech|Short', 'English', 2017, 'U', '10m', 6.5, 'An adaptive stream that changes quality with your connection. Watch it switch.', '', icon('apple_test_pattern')],
];

const EPISODES = ['Pilot', 'The Offer', 'Fault Lines', 'Crossfire', 'No Way Back', 'Endgame'];
let rank = 0;
const titles = LIST.map(([id, title, kind, genres, language, year, rating, length, score, about, rows, art], i) => {
  const seasons = kind === 'Show' ? parseInt(length, 10) || 1 : 0;
  const tags = rows ? rows.split('|') : [];
  const progress = [35, 72, 15, 50][i % 4];
  return {
    kind, id, title, genre: genres.split('|')[0], genres: genres.split('|').join(' | '), language, year, rating, length, score, about,
    poster: art || img(id, 640, 400), backdrop: art || img(id + '-wide', 1280, 640), src: play(i), seasons,
    rows: tags, rank: tags.includes('top10') ? ++rank : 0, progress,
    left: (seasons ? 'S1 E' + (2 + (i % 4)) + ' · ' : '') + Math.round((100 - progress) / 100 * (seasons ? 40 : /h/.test(length) ? parseInt(length, 10) * 60 + (parseInt(length.split(' ')[1], 10) || 0) : parseInt(length, 10) || 40)) + 'm left',
    cast: ['Aarav Mehta', 'Diya Rao', 'Kabir Singh', 'Meera Iyer', 'Rohan Das'].slice(i % 3, (i % 3) + 3).join(', '),
    episodes: Array.from({ length: seasons * 6 }, (_, n) => ({
      season: Math.floor(n / 6) + 1, number: (n % 6) + 1, name: EPISODES[n % 6],
      label: 'S' + (Math.floor(n / 6) + 1) + ' E' + ((n % 6) + 1) + ' · ' + EPISODES[n % 6],
      length: (22 + ((i + n) % 4) * 6) + 'm', still: img(id + '-ep' + n, 640, 400), src: play(i + n),
    })),
  };
});

const soon = new Date(Date.now() + 5 * 3600e3 + 23 * 60e3).toISOString().slice(0, 16);
const live = [
  ['cricket', 'India vs Australia', 'Cricket', '3rd ODI · Wankhede, Mumbai', 'IND 287/4 (44.2)', 'LIVE', '2.1 Cr watching'],
  ['football', 'Kolkata FC vs Goa United', 'Football', 'Super League · Matchday 12', '1 – 1 · 67′', 'LIVE', '38 L watching'],
  ['kabaddi-live', 'Jaipur vs Patna', 'Kabaddi', 'Pro League · Semi-final', '24 – 21 · 2nd half', 'LIVE', '12 L watching'],
  ['badminton', 'Open Finals: Women’s Singles', 'Badminton', 'Starts later today', 'Starts soon', 'UPCOMING', 'Set a reminder'],
].map(([id, title, sport, meta, score, status, watching], i) => ({
  kind: 'Live', id, title, sport, meta, score, status, watching, startsAt: status === 'UPCOMING' ? soon : '',
  genre: sport, genres: sport, language: 'Hindi', rating: 'U', length: status, about: meta + ' · ' + score,
  poster: img(id, 640, 400), backdrop: img(id + '-wide', 1280, 640), src: play(i + 3), rows: ['live'], episodes: [], seasons: 0,
}));

const plans = [
  ['Mobile', 79, 149, 499, '1 mobile', 'HD 720p', 'With ads', 'Stereo', 'No'],
  ['Super', 149, 299, 899, '2 (TV, laptop, mobile)', 'Full HD 1080p', 'With ads', 'Dolby 5.1', 'Yes'],
  ['Premium', 299, 499, 1499, '4 (TV, laptop, mobile)', '4K + Dolby Vision', 'Ad-free', 'Dolby Atmos', 'Yes'],
].map(([plan, monthly, quarterly, yearly, devices, quality, ads, audio, downloads]) => ({ kind: 'Plan', id: plan.toLowerCase(), title: plan, plan, monthly, quarterly, yearly, devices, quality, ads, audio, downloads, rows: [] }));

return [...titles, ...live, ...plans];`;

/* The app: pages of components. `data.cat` is the workflow's output; vars hold what people pick. */
const C = (id, type, name, x, y, w, h, props) => ({ id, type, name, x, y, w, h, props });
const go = page => ({ kind: 'go', page }), set = (name, value) => ({ kind: 'set', name, value }), toast = text => ({ kind: 'toast', text });
const all = '(data.cat || [])';
const titles = `${all}.filter(t => t.kind !== "Plan" && t.kind !== "Live")`;
const row = name => `{{ ${all}.filter(t => t.rows.includes("${name}")).slice(0, 8) }}`;
const spot = `(${all}.filter(t => t.rows.includes("spotlight"))[vars.spotlight || 0] || {})`;
const matches = q => `${all}.filter(t => t.kind !== "Plan" && (t.title + " " + t.genres + " " + t.language + " " + (t.cast || "")).toLowerCase().includes(${q}))`;
const query = '(vars.query || vars.trending || "").trim().toLowerCase()';
// Open a title's page, or play something.
const open = [set('title', '{{ item }}'), set('season', '1'), go('title')];
const watchIt = what => [set('playing', what), set('episode', '{{ null }}'), go('watch')];
const tray = (id, y, heading, rows, extra = {}) => [
  C(id + 'H', 'heading', id + 'Heading', 0, y, 9, 5, { text: heading, size: 'md' }),
  C(id + 'A', 'button', id + 'All', 9, y, 3, 6, { label: 'View all ›', look: 'link', steps: [go(extra.all || 'movies')] }),
  C(id, 'list', id, 0, y + 6, 12, extra.h || 50, { rows, title: extra.title || '{{ item.title }}', subtitle: extra.subtitle || '{{ item.year + " · " + item.length + " · " + item.language }}', image: '{{ item.poster }}', steps: extra.steps || open }),
];

export const ottSpec = () => ({
  name: 'StarPlay', nav: 'side',
  theme: { primary: '#1f80e0', bg: '#0f1014', surface: '#16181f', text: '#f5f5f7', dark: true, radius: 12, font: 'system' },
  data: [{ id: 's1', name: 'cat', workflow: 'StarPlay', input: [], auto: true }],
  pages: [
    { id: 'home', name: 'Home', nav: true, components: [
      // Spotlight: a slideshow of the featured titles, and the one showing beside it.
      C('h1', 'carousel', 'spotlight', 0, 0, 8, 44, { images: `{{ ${all}.filter(t => t.rows.includes("spotlight")).map(t => t.backdrop) }}`, every: 6 }),
      C('h2', 'badge', 'spotKind', 8, 0, 4, 5, { text: `{{ ${spot}.title ? (${spot}.year >= 2025 ? "NEWLY ADDED · " : "TRENDING · ") + ${spot}.kind : "" }}`, tone: 'blue' }),
      C('h3', 'heading', 'spotTitle', 8, 6, 4, 9, { text: `{{ ${spot}.title || "Loading…" }}`, size: 'lg' }),
      C('h4', 'text', 'spotMeta', 8, 16, 4, 5, { text: `{{ ${spot}.title ? "**" + ${spot}.year + " · " + ${spot}.length + " · " + ${spot}.language + " · " + ${spot}.rating + "**" : "" }}` }),
      C('h5', 'text', 'spotAbout', 8, 22, 4, 11, { text: `{{ ${spot}.about || "" }}` }),
      C('h6', 'text', 'spotGenres', 8, 33, 4, 4, { text: `{{ ${spot}.genres || "" }}` }),
      C('h7', 'button', 'watchNow', 8, 38, 3, 7, { label: '▶ Watch Now', look: 'primary', steps: watchIt(`{{ ${spot} }}`) }),
      C('h8', 'button', 'spotAdd', 11, 38, 1, 7, { label: '+', look: 'secondary', steps: [set('watchlist', `{{ (vars.watchlist || []).some(t => t.id === ${spot}.id) ? vars.watchlist : [...(vars.watchlist || []), ${spot}] }}`), toast('Added to Watchlist')] }),
      ...tray('continue', 46, '{{ "Continue Watching for " + (vars.profile || "Riya") }}', row('continue'), { subtitle: '{{ item.left }}', all: 'myspace', h: 26 }),
      ...tray('top10', 80, 'Top 10 in India Today', `{{ ${all}.filter(t => t.rank).sort((a, b) => a.rank - b.rank).slice(0, 8) }}`, { title: '{{ "#" + item.rank + "  " + item.title }}' }),
      ...tray('live', 138, '🔴 Live Sports', row('live'), { subtitle: '{{ (item.status === "LIVE" ? "● LIVE · " : "UPCOMING · ") + item.score + " · " + item.watching }}', steps: watchIt('{{ item }}'), all: 'sports', h: 26 }),
      ...tray('latest', 172, 'Latest Releases', row('latest')),
      ...tray('popular', 230, 'Popular Shows', row('popular'), { all: 'tv' }),
      C('langH', 'heading', 'langHeading', 0, 288, 12, 5, { text: 'Popular Languages', size: 'md' }),
      C('lang', 'radio', 'lang', 0, 294, 12, 6, { label: '', options: 'Hindi, English, Tamil, Telugu, Malayalam, Bengali, Marathi', value: 'Hindi', inline: true }),
      C('langList', 'list', 'langList', 0, 301, 12, 50, { rows: `{{ ${titles}.filter(t => t.language === vars.lang).slice(0, 8) }}`, title: '{{ item.title }}', subtitle: '{{ item.genres }}', image: '{{ item.poster }}', steps: open }),
      ...tray('thrillers', 353, 'Thrillers You Can’t Pause', row('thriller')),
      ...tray('kids', 411, 'For the Little Ones', row('kids'), { h: 26 }),
      ...tray('docs', 445, 'Documentaries', row('docs'), { h: 26 }),
    ] },
    { id: 'tv', name: 'TV', nav: true, components: [
      C('t1', 'heading', 'heading1', 0, 0, 12, 7, { text: 'TV Shows', size: 'lg' }),
      C('t2', 'radio', 'tvGenre', 0, 8, 12, 6, { label: '', options: `{{ ["All", ...new Set(${all}.filter(t => t.kind === "Show").map(t => t.genre))] }}`, value: 'All', inline: true }),
      C('t3', 'list', 'shows', 0, 15, 12, 100, { rows: `{{ ${all}.filter(t => t.kind === "Show" && (!vars.tvGenre || vars.tvGenre === "All" || t.genres.includes(vars.tvGenre))) }}`, title: '{{ item.title }}', subtitle: '{{ item.length + " · " + item.genres }}', image: '{{ item.poster }}', steps: open }),
    ] },
    { id: 'movies', name: 'Movies', nav: true, components: [
      C('m1', 'heading', 'heading1', 0, 0, 6, 7, { text: 'Movies', size: 'lg' }),
      C('m2', 'select', 'movieLang', 6, 0, 3, 9, { label: 'Language', options: 'All, Hindi, English, Tamil, Telugu, Malayalam, Bengali, Marathi', value: 'All' }),
      C('m3', 'select', 'movieSort', 9, 0, 3, 9, { label: 'Sort by', options: 'Popular, Newest, A to Z', value: 'Popular' }),
      C('m4', 'radio', 'movieGenre', 0, 10, 12, 6, { label: '', options: `{{ ["All", ...new Set(${all}.filter(t => t.kind === "Movie").map(t => t.genre))] }}`, value: 'All', inline: true }),
      C('m5', 'list', 'movies', 0, 17, 12, 150, { rows: `{{ ${all}.filter(t => t.kind === "Movie" && (!vars.movieLang || vars.movieLang === "All" || t.language === vars.movieLang) && (!vars.movieGenre || vars.movieGenre === "All" || t.genres.includes(vars.movieGenre))).sort((a, b) => vars.movieSort === "Newest" ? b.year - a.year : vars.movieSort === "A to Z" ? a.title.localeCompare(b.title) : b.score - a.score) }}`, title: '{{ item.title }}', subtitle: '{{ "★ " + item.score + " · " + item.year + " · " + item.language }}', image: '{{ item.poster }}', steps: open }),
    ] },
    { id: 'sports', name: 'Sports', nav: true, components: [
      C('s1', 'heading', 'heading1', 0, 0, 8, 7, { text: 'Sports', size: 'lg' }),
      C('s2', 'countdown', 'nextMatch', 8, 0, 4, 12, { label: `{{ (${all}.find(t => t.status === "UPCOMING") || {}).title || "Next match" }}`, to: `{{ (${all}.find(t => t.status === "UPCOMING") || {}).startsAt }}`, done: 'Live now!' }),
      C('s3', 'alert', 'liveNote', 0, 13, 12, 9, { tone: 'error', title: `{{ "● " + ${all}.filter(t => t.status === "LIVE").length + " matches live now" }}`, text: 'Tap a match to watch it live, with commentary in Hindi or English.' }),
      C('s4', 'list', 'matches', 0, 23, 12, 50, { rows: `{{ ${all}.filter(t => t.kind === "Live") }}`, title: '{{ item.title }}', subtitle: '{{ (item.status === "LIVE" ? "● LIVE · " : "UPCOMING · ") + item.sport + " · " + item.score }}', image: '{{ item.poster }}', steps: watchIt('{{ item }}') }),
      C('s5', 'heading', 'heading2', 0, 75, 12, 5, { text: 'Replays & Highlights', size: 'md' }),
      C('s6', 'list', 'replays', 0, 81, 12, 26, { rows: `{{ ${all}.filter(t => t.kind === "Sports") }}`, title: '{{ item.title }}', subtitle: '{{ item.length }}', image: '{{ item.poster }}', steps: open }),
    ] },
    { id: 'search', name: 'Search', nav: true, components: [
      C('q1', 'heading', 'heading1', 0, 0, 12, 7, { text: 'Search', size: 'lg' }),
      C('q2', 'search', 'query', 0, 8, 12, 6, { placeholder: 'Movies, shows, sports, languages…' }),
      C('q3', 'radio', 'trending', 0, 15, 12, 6, { label: 'Trending', options: 'Code Red, Cricket, Hostel, Kaveri, Sci-Fi, Kids', value: ' ', inline: true }),
      C('q4', 'text', 'resultCount', 0, 22, 12, 5, { text: `{{ ${query} ? ${matches(query)}.length + " results" : "Popular searches" }}` }),
      C('q5', 'list', 'results', 0, 28, 12, 100, { rows: `{{ ${query} ? ${matches(query)} : ${titles}.slice(0, 8) }}`, title: '{{ item.title }}', subtitle: '{{ item.kind + " · " + item.genres }}', image: '{{ item.poster }}', steps: open }),
    ] },
    { id: 'myspace', name: 'My Space', nav: true, components: [
      C('p1', 'avatar', 'me', 0, 0, 4, 8, { name: '{{ vars.profile || "Riya" }}', subtitle: '{{ vars.profile === "Kids" ? "Kids profile" : "Free plan" }}', image: '' }),
      C('p2', 'radio', 'profile', 4, 0, 8, 8, { label: 'Who’s watching?', options: 'Riya, Dad, Kids', value: 'Riya', inline: true, steps: [toast('{{ "Watching as " + vars.profile }}')] }),
      C('p3', 'box', 'subscribeBox', 0, 10, 12, 16, { title: 'You’re on the free plan', tint: 'linear-gradient(90deg, #1d2440, #16181f)' }),
      C('p4', 'text', 'subscribeText', 0, 16, 8, 8, { text: 'Subscribe to watch the latest releases, live sports in 4K and download to watch offline.' }),
      C('p5', 'button', 'subscribe', 9, 16, 3, 7, { label: 'Subscribe', look: 'primary', steps: [go('plans')] }),
      C('p6', 'heading', 'heading1', 0, 28, 12, 5, { text: '{{ "Watchlist (" + (vars.watchlist || []).length + ")" }}', size: 'md' }),
      C('p7', 'list', 'watchlist', 0, 34, 12, 50, { rows: '{{ vars.watchlist || [] }}', title: '{{ item.title }}', subtitle: '{{ item.year + " · " + item.length }}', image: '{{ item.poster }}', steps: open }),
      ...tray('again', 86, 'Continue Watching', row('continue'), { subtitle: '{{ item.left }}', all: 'home', h: 26 }),
    ] },
    { id: 'title', name: 'Title', nav: false, components: [
      C('d1', 'button', 'back', 0, 0, 2, 5, { label: '← Back', look: 'link', steps: [go('home')] }),
      C('d2', 'hero', 'titleHero', 0, 6, 12, 46, { kicker: '{{ vars.title ? vars.title.kind + " · " + vars.title.year + " · " + vars.title.length + " · " + vars.title.rating : "" }}', title: '{{ vars.title ? vars.title.title : "Pick a title" }}', subtitle: '{{ vars.title ? vars.title.about : "" }}', button: '{{ vars.title && vars.title.seasons ? "▶ Watch S1 E1" : "▶ Watch Now" }}', image: '{{ vars.title && vars.title.backdrop }}', align: 'left',
        steps: [set('playing', '{{ vars.title }}'), set('episode', '{{ vars.title.episodes[0] || null }}'), go('watch')] }),
      C('d3', 'badge', 'genreBadge', 0, 53, 2, 5, { text: '{{ vars.title && vars.title.genre }}', tone: 'blue' }),
      C('d4', 'badge', 'langBadge', 2, 53, 2, 5, { text: '{{ vars.title && vars.title.language }}', tone: 'purple' }),
      C('d5', 'badge', 'scoreBadge', 4, 53, 2, 5, { text: '{{ vars.title ? "★ " + vars.title.score : "" }}', tone: 'amber' }),
      C('d6', 'button', 'add', 8, 52, 4, 7, { label: '{{ (vars.watchlist || []).some(t => vars.title && t.id === vars.title.id) ? "✓ In Watchlist" : "+ Watchlist" }}', look: 'secondary', steps: [set('watchlist', '{{ (vars.watchlist || []).some(t => t.id === vars.title.id) ? vars.watchlist.filter(t => t.id !== vars.title.id) : [...(vars.watchlist || []), vars.title] }}'), toast('Watchlist updated')] }),
      C('d7', 'tabs', 'info', 0, 60, 8, 22, { tabs: 'Overview | {{ vars.title ? vars.title.about + " **Genres:** " + vars.title.genres : "" }}\nCast | {{ vars.title ? vars.title.cast : "" }}\nAudio | Hindi, English, Tamil, Telugu · Subtitles: English, Hindi' }),
      C('d8', 'rating', 'myRating', 8, 60, 4, 9, { label: 'Rate this', max: 5, steps: [toast('Thanks! We’ll recommend more like this.')] }),
      C('d9', 'select', 'season', 8, 70, 4, 9, { label: 'Season', options: '{{ vars.title && vars.title.seasons ? Array.from({ length: vars.title.seasons }, (_, i) => ({ label: "Season " + (i + 1), value: i + 1 })) : [{ label: "Movie", value: 1 }] }}', value: '1' }),
      C('d10', 'heading', 'episodesHeading', 0, 83, 12, 5, { text: '{{ vars.title && vars.title.seasons ? "Episodes" : "" }}', size: 'md' }),
      C('d11', 'list', 'episodes', 0, 89, 12, 50, { rows: '{{ vars.title && vars.title.episodes ? vars.title.episodes.filter(e => e.season == (vars.season || 1)) : [] }}', title: '{{ "E" + item.number + " · " + item.name }}', subtitle: '{{ item.length }}', image: '{{ item.still }}', steps: [set('playing', '{{ vars.title }}'), set('episode', '{{ item }}'), go('watch')] }),
      C('d12', 'heading', 'moreHeading', 0, 141, 12, 5, { text: 'More Like This', size: 'md' }),
      C('d13', 'list', 'more', 0, 147, 12, 50, { rows: `{{ vars.title ? ${titles}.filter(t => t.id !== vars.title.id && (t.genre === vars.title.genre || t.language === vars.title.language)).slice(0, 8) : [] }}`, title: '{{ item.title }}', subtitle: '{{ item.year + " · " + item.length }}', image: '{{ item.poster }}', steps: open }),
    ] },
    { id: 'watch', name: 'Watch', nav: false, components: [
      C('w1', 'button', 'back', 0, 0, 2, 5, { label: '← Back', look: 'link', steps: [go('home')] }),
      C('w2', 'video', 'player', 0, 6, 8, 52, { src: '{{ vars.episode ? vars.episode.src : vars.playing && vars.playing.src }}', poster: '{{ vars.episode ? vars.episode.still : vars.playing && vars.playing.backdrop }}' }),
      C('w3', 'heading', 'nowPlaying', 8, 6, 4, 9, { text: '{{ vars.playing ? vars.playing.title + (vars.episode ? " · " + vars.episode.label : "") : "Nothing playing" }}', size: 'md' }),
      C('w4', 'badge', 'liveBadge', 8, 16, 2, 5, { text: '{{ vars.playing && vars.playing.kind === "Live" ? "● " + vars.playing.status : "HD" }}', tone: 'red' }),
      C('w5', 'badge', 'ratingBadge', 10, 16, 2, 5, { text: '{{ vars.playing && vars.playing.rating }}', tone: 'gray' }),
      C('w6', 'text', 'nowAbout', 8, 22, 4, 12, { text: '{{ vars.playing ? vars.playing.about : "" }}' }),
      C('w7', 'select', 'audio', 8, 35, 4, 9, { label: 'Audio', options: 'Hindi, English, Tamil, Telugu', value: 'Hindi', steps: [toast('{{ "Audio: " + vars.audio }}')] }),
      C('w8', 'switch', 'subtitles', 8, 45, 4, 5, { label: 'Subtitles', value: false }),
      C('w9', 'slider', 'quality', 8, 51, 4, 9, { label: 'Quality', min: 360, max: 2160, step: 360, value: 1080, unit: 'p' }),
      C('w10', 'heading', 'upNextHeading', 0, 60, 12, 5, { text: '{{ vars.episode ? "Episodes" : "Up Next" }}', size: 'md' }),
      C('w11', 'list', 'upNext', 0, 66, 12, 50, { rows: `{{ vars.episode && vars.playing ? vars.playing.episodes.filter(e => e.season === vars.episode.season) : ${titles}.filter(t => !vars.playing || t.id !== vars.playing.id).slice(0, 8) }}`, title: '{{ item.label || item.title }}', subtitle: '{{ item.length }}', image: '{{ item.still || item.poster }}', steps: [set('episode', '{{ item.label ? item : null }}'), set('playing', '{{ item.label ? vars.playing : item }}')] }),
    ] },
    { id: 'plans', name: 'Subscribe', nav: true, components: [
      C('b1', 'heading', 'heading1', 0, 0, 8, 7, { text: 'Choose your plan', size: 'lg' }),
      C('b2', 'radio', 'period', 0, 8, 12, 6, { label: '', options: 'Monthly, 3 Months, Yearly', value: '3 Months', inline: true }),
      ...['Mobile', 'Super', 'Premium'].map((p, i) => C('b' + (3 + i), 'stat', 'price' + p, i * 4, 15, 4, 14, { label: p + (p === 'Super' ? '  ★ Most popular' : ''), value: `{{ (p => p ? "₹" + (vars.period === "Monthly" ? p.monthly : vars.period === "Yearly" ? p.yearly : p.quarterly) : "–")(${all}.find(t => t.plan === "${p}")) }}`, note: '{{ vars.period === "Monthly" ? "per month" : vars.period === "Yearly" ? "per year" : "per 3 months" }}', card: true })),
      C('b6', 'table', 'compare', 0, 30, 12, 30, { title: 'Compare plans', rows: `{{ ${all}.filter(t => t.kind === "Plan") }}`, columns: 'plan, devices, quality, ads, audio, downloads', search: false, card: true }),
      C('b7', 'radio', 'chosen', 0, 61, 6, 16, { label: 'Your plan', options: 'Mobile, Super, Premium', value: 'Super' }),
      C('b8', 'form', 'pay', 6, 61, 6, 32, { title: '{{ "Pay for " + (vars.chosen || "Super") + " · " + vars.period }}', fields: 'Name*\nMobile number* (tel)', button: 'Continue to pay', thanks: 'This is a demo. Connect a payment workflow (Razorpay, Stripe) to take real payments.', steps: [toast('Demo: no payment taken')] }),
      C('b9', 'accordion', 'faq', 0, 78, 6, 26, { items: 'Can I cancel anytime? | Yes. Your plan runs to the end of the period you paid for.\nHow many devices? | Mobile: 1, Super: 2, Premium: 4 at the same time.\nIs live sport included? | Yes, on every plan.', rows: '' }),
    ] },
  ],
});

/* StarPlay 2: the same service as one workflow made only of nodes (Page trigger and UI nodes, no app).
   The page runs the workflow top to bottom: each UI node draws the items reaching it, so "Pick" Code
   nodes in between choose what the next section shows; the catalogue rides along on every item as _cat. */
const KEEP = String.raw`const { _cat: cat = [], _q: q = {}, _search: search = '', _thanks: thanks = '' } = items[0] || {};
const titles = cat.filter(t => t.kind !== 'Plan' && t.kind !== 'Live');
// Each item keeps the catalogue and the page's choice for the nodes after it, and a link to play it.
const keep = list => list.map(t => ({ ...t, _cat: cat, _q: q, _search: search, _thanks: thanks, _link: '?page=watch&video=' + t.id }));
`;

export const OTT2_FIRST = String.raw`// STEP 4. "Fetch video files" got the videos; "Remember the choice" added what the page asked for:
// q (from the menu and links: ?page=…&tab=…&video=…&ep=…), search (the search box), action and form.
// Here: build the catalogue, work out which page to show (_page, for the Switch), and what's featured
// or playing. A page made of nodes plays MP4 (HLS needs a script).
const cat = (items => {
` + OTT_CATALOGUE + String.raw`
})(items.filter(v => /\.mp4(\?|$)/.test(v.src)));

const first = items[0] || {};
const q = first.q || {}, search = String(first.search || '').trim();
const titles = cat.filter(t => t.kind !== 'Plan' && t.kind !== 'Live');
let playing = cat.find(t => t.id === q.video) || titles.find(t => t.rows.includes('spotlight'));
const ep = playing.episodes && playing.episodes[Number(q.ep) || 0];
if (ep && q.ep !== undefined) playing = { ...playing, src: ep.src, backdrop: ep.still, title: playing.title + ' · ' + ep.label };
const thanks = first.action === 'subscribe' && first.form && first.form.name
  ? '**✅ Thanks, ' + first.form.name + '!** This is a demo: add a payment node (Razorpay, Stripe) to take real payments.\n\n' : '';
// Which page: a search shows results (browse), the subscribe form comes back to plans, else ?page=….
const page = first.action === 'search' && search ? 'browse' : first.action === 'subscribe' ? 'plans' : ['watch', 'browse', 'sports', 'plans'].includes(q.page) ? q.page : 'home';
return [{ ...playing, _page: page, _thanks: thanks, _cat: cat, _q: q, _search: search }];`;

export const OTT2_EPISODES = KEEP + String.raw`
// A show: its episodes. A movie: more like it.
const playing = cat.find(t => t.id === q.video) || titles.find(t => t.rows.includes('spotlight'));
if (playing.seasons) return keep(playing.episodes).map((e, n) => ({ ...e, title: e.label, poster: e.still, _heading: 'Episodes', _link: '?page=watch&video=' + playing.id + '&ep=' + n }));
return keep(titles.filter(t => t.id !== playing.id && (t.genre === playing.genre || t.language === playing.language)).slice(0, 8)).map(t => ({ ...t, _heading: 'More Like This' }));`;

export const OTT2_ROW = KEEP + String.raw`
// The menu's tab (?tab=…) or what was searched for.
const tabs = { movies: ['Movies', t => t.kind === 'Movie'], shows: ['TV Shows', t => t.kind === 'Show'], sports: ['Sports', t => t.kind === 'Sports' || t.kind === 'Live'], kids: ['Kids', t => t.rows.includes('kids')] };
let heading, list;
if (search) {
  list = titles.filter(t => (t.title + ' ' + t.genres + ' ' + t.language + ' ' + t.cast).toLowerCase().includes(search.toLowerCase()));
  heading = list.length ? list.length + ' results for “' + search + '”' : 'Nothing for “' + search + '”: popular instead';
  if (!list.length) list = titles.filter(t => t.rows.includes('popular'));
} else if (tabs[q.tab]) { heading = tabs[q.tab][0]; list = cat.filter(tabs[q.tab][1]); }
else { heading = 'Latest Releases'; list = titles.filter(t => t.rows.includes('latest')); }
return keep(list).map(t => ({ ...t, _heading: heading }));`;

export const OTT2_TOP10 = KEEP + String.raw`
return keep(titles.filter(t => t.rank).sort((a, b) => a.rank - b.rank));`;

export const OTT2_LIVE = KEEP + String.raw`
return keep(cat.filter(t => t.kind === 'Live')).map(t => ({ ...t, match: t.title }));`;

export const OTT2_PLANS = KEEP + String.raw`
return keep(cat.filter(t => t.kind === 'Plan'));`;
