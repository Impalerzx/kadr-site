// Практика 2: функции, DOM, события, JSON, fetch, async/await и localStorage.
// Без классов, модулей, библиотек и серверной логики.
const $ = selector => document.querySelector(selector);
const STORAGE_KEY = 'kadr-watchlist-v1';
let saved = readSaved();
let results = [];
let kind = 'all';
let listFilter = 'pending';
let searchNumber = 0;
let activeController;
let lastQuery = '';
let toastTimer;
const cache = new Map();
const detailsCache = new Map();
let moviePage = 1;
let movieTotal = 0;
let detailNumber = 0;

function readSaved() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(data) ? data.filter(item => item && typeof item.id === 'string' && typeof item.title === 'string' && ['movie','series'].includes(item.kind)).slice(0,200) : [];
  } catch { return []; }
}
function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); $('#storage-status').textContent = ''; }
  catch { $('#storage-status').textContent = 'Не удалось сохранить список. Сейчас изменения доступны только до закрытия страницы.'; }
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function safeUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : ''; } catch { return ''; }
}
function plainText(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  return doc.body.textContent.trim();
}
function year(value) { return /^\d{4}/.test(value || '') ? value.slice(0,4) : 'Год не указан'; }
function typeName(item) { return item.kind === 'movie' ? 'Фильм' : 'Сериал'; }
function metadata(item) { return [item.year, item.duration ? item.duration + ' мин' + (item.kind === 'series' ? ' / серия' : '') : null].filter(Boolean).join(' · '); }
function notify(message) {
  $('#toast').textContent = message; $('#toast').classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('show'),2800);
}
async function fetchJSON(url, signal) {
  const response = await fetch(url,{signal});
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.json();
}
function omdbError(message) {
  if (/invalid api key|no api key/i.test(message)) return 'Ключ OMDb не активирован или неверен. Проверьте активацию через письмо.';
  if (/limit/i.test(message)) return 'Достигнут лимит запросов OMDb. Попробуйте позже.';
  if (/too many/i.test(message)) return 'Слишком общий запрос. Уточните название фильма.';
  return 'OMDb: ' + (message || 'не удалось получить данные');
}
async function omdb(params, signal) {
  // OMDb возвращает полезную JSON-ошибку и при HTTP 401: читаем её до проверки статуса.
  const response = await fetch('https://www.omdbapi.com/?' + new URLSearchParams({apikey:OMDB_API_KEY,...params}),{signal});
  const data = await response.json();
  if (data.Response === 'False' && !/movie not found/i.test(data.Error || '')) throw new Error(omdbError(data.Error));
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return data;
}
async function getMovies(query, signal, page = 1) {
  const data = await omdb({s:query,type:'movie',page:String(page)},signal);
  if(data.Response === 'False') return {items:[],total:0};
  if(!Array.isArray(data.Search)) throw new Error('Некорректный ответ OMDb');
  return {total:Number(data.totalResults)||0,items:data.Search.filter(movie => /^tt\d+$/.test(movie.imdbID)).map(movie => ({
    id:'movie-'+movie.imdbID,kind:'movie',title:movie.Title,year:movie.Year || 'Год не указан',duration:null,genre:'',
    description:'',poster:safeUrl(movie.Poster),url:'https://www.imdb.com/title/'+movie.imdbID+'/',source:'OMDb',rating:null
  }))};
}
async function getSeries(query, signal) {
  const data = await fetchJSON('https://api.tvmaze.com/search/shows?' + new URLSearchParams({q:query}),signal);
  if (!Array.isArray(data)) throw new Error('Некорректный ответ TVmaze');
  return data.filter(row => row.show?.id && row.show?.name).slice(0,18).map(({show}) => ({
    id:'series-'+show.id,kind:'series',title:show.name,year:year(show.premiered),
    duration:show.averageRuntime || show.runtime || null,genre:show.genres?.join(' / ') || 'Жанр не указан',
    description:plainText(show.summary),poster:safeUrl(show.image?.medium),url:safeUrl(show.url),source:'TVmaze',rating:show.rating?.average || null
  }));
}
async function search(query) {
  query = query.trim();
  if (!query) { $('#query').focus(); return; }
  lastQuery = query;
  moviePage = 1; movieTotal = 0;
  $('#load-more').hidden = true; $('#load-more').disabled = false;
  const number = ++searchNumber;
  activeController?.abort(); activeController = new AbortController();
  const controller = activeController;
  const timeout = setTimeout(() => controller.abort(),18000);
  $('#results').setAttribute('aria-busy','true'); $('#results').replaceChildren();
  for(let i=0;i<6;i++) $('#results').append(element('div','skeleton'));
  $('#search-status').textContent = 'Ищем «' + query + '» в двух каталогах…';
  $('#source-errors').replaceChildren(); $('#retry').hidden = true;
  const cached = cache.get(query.toLowerCase());
  const responses = cached || await Promise.allSettled([getMovies(query,controller.signal),getSeries(query,controller.signal)]);
  clearTimeout(timeout);
  if(number !== searchNumber) return;
  const names=['OMDb — фильмы','TVmaze — сериалы'];
  results = [];
  responses.forEach((response,index) => {
    if(response.status === 'fulfilled') {
      if(index === 0) {results.push(...response.value.items); movieTotal=response.value.total;}
      else results.push(...response.value);
    } else {
      const message=response.reason?.message || '';
      const explanation=index===0 && /Ключ|лимит|общий запрос/.test(message) ? message : 'источник недоступен. Проверьте интернет и повторите поиск.';
      $('#source-errors').append(element('p','',names[index] + ': ' + explanation));
    }
  });
  if(responses.every(response => response.status === 'fulfilled')) cache.set(query.toLowerCase(), responses);
  $('#retry').hidden = responses.every(response => response.status === 'fulfilled');
  $('#results').setAttribute('aria-busy','false');
  renderResults();
}
async function loadMore() {
  const number = searchNumber;
  const query = lastQuery;
  $('#load-more').disabled = true;
  $('#load-more').textContent = 'Загрузка…';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(),18000);
  try {
    const data = await getMovies(query,controller.signal,moviePage+1);
    if(number!==searchNumber) return;
    const ids=new Set(results.map(item=>item.id));
    results.push(...data.items.filter(item=>!ids.has(item.id)));
    moviePage++; movieTotal=data.total; renderResults();
  } catch(error) {if(number===searchNumber) notify(error.message.startsWith('Ключ')?error.message:'Не удалось загрузить следующую страницу. Попробуйте ещё раз.');}
  finally {clearTimeout(timer);if(number===searchNumber) {$('#load-more').disabled=false;$('#load-more').textContent='Ещё фильмы ↓';}}
}
function poster(item, className) {
  const image = element('img',className); image.alt = 'Постер: ' + item.title; image.loading = 'lazy';
  const url=safeUrl(item.poster);
  if(url) image.src=url;
  image.addEventListener('error',() => image.replaceWith(placeholder()));
  return url ? image : placeholder();
}
function placeholder() {
  const box=element('div','no-poster'); box.append(element('span','','▰'),element('small','','Постер недоступен')); return box;
}
function saveButton(item) {
  const isSaved = saved.some(entry => entry.id === item.id);
  const button=element('button','save-button'+(isSaved?' saved':''),isSaved?'✓':'+');
  button.dataset.saveId=item.id; button.setAttribute('aria-pressed',String(isSaved));
  button.setAttribute('aria-label',(isSaved?'Удалить из списка: ':'Добавить в список: ')+item.title);
  button.addEventListener('click',() => toggleSaved(item)); return button;
}
function renderResults() {
  const shown=results.filter(item => kind === 'all' || item.kind === kind);
  const sort=$('#sort').value;
  if(sort === 'title') shown.sort((a,b) => a.title.localeCompare(b.title));
  if(sort === 'year') shown.sort((a,b) => (parseInt(b.year)||0)-(parseInt(a.year)||0));
  $('#results').replaceChildren();
  $('#search-status').textContent = '«'+lastQuery+'» · показано: '+shown.length + (kind!=='series' && movieTotal ? ' · фильмов в OMDb: '+movieTotal : '');
  $('#load-more').hidden = kind==='series' || moviePage*10>=movieTotal || moviePage>=100;
  if(!shown.length) {
    const failed=!$('#retry').hidden;
    $('#results').append(element('div','empty-results',failed?'Не удалось получить результаты для выбранного типа. Попробуйте повторить запрос.':'Пока ничего не найдено. Попробуйте оригинальное название: например, Dune, Dark или Sherlock.'));
  }
  shown.forEach(item => {
    const card=element('article','card'); const wrap=element('div','poster-wrap');
    const open=element('button','poster-button'); open.setAttribute('aria-label','Подробнее: '+item.title); open.append(poster(item)); open.addEventListener('click',() => showDetails(item));
    wrap.append(open,saveButton(item));
    const title=element('button','title-button'); title.append(element('h3','',item.title)); title.addEventListener('click',() => showDetails(item));
    card.append(wrap,element('div','card-type',typeName(item)+' / '+item.source),title,element('p','card-meta',metadata(item)));
    $('#results').append(card);
  });
}
function toggleSaved(item) {
  const index=saved.findIndex(entry => entry.id===item.id);
  if(index>=0) {saved.splice(index,1);notify('Удалено из списка');}
  else {
    if(saved.length>=200) {notify('В списке уже 200 историй. Удалите одну, чтобы добавить новую.');return;}
    saved.push({...item,done:false});notify('Добавлено в «Посмотреть»');
  }
  persist();renderSaved();refreshSaveButtons();
}
function refreshSaveButtons() {
  document.querySelectorAll('[data-save-id]').forEach(button => {
    const isSaved=saved.some(item => item.id===button.dataset.saveId);
    button.classList.toggle('saved',isSaved);button.setAttribute('aria-pressed',String(isSaved));
    if(button.classList.contains('save-button')) {
      button.textContent=isSaved?'✓':'+';
      const item=results.find(item => item.id===button.dataset.saveId);
      if(item) button.setAttribute('aria-label',(isSaved?'Удалить из списка: ':'Добавить в список: ')+item.title);
    } else button.textContent=isSaved?'✓ В списке · убрать':'+ В список «посмотреть»';
  });
}
function renderSaved() {
  const pending=saved.filter(item => !item.done).length;
  $('#header-count').textContent=saved.length;$('#list-count').textContent=saved.length;
  $('#pending-count').textContent=pending;$('#done-count').textContent=saved.length-pending;
  const shown=saved.filter(item => listFilter==='done'?item.done:!item.done);
  $('#saved-items').replaceChildren();
  if(!shown.length) {
    const empty=element('div','empty-list');
    empty.append(element('span','empty-icon','▱'),element('h3','',listFilter==='done'?'Истории ещё впереди':'Здесь начинается твой вечер'),element('p','',listFilter==='done'?'Отмечай просмотренное — оно появится здесь.':'Нажми + на постере, чтобы сохранить фильм или сериал.'));
    $('#saved-items').append(empty);
  }
  shown.forEach(item => {
    const row=element('article','saved-row'); const main=element('div','saved-main');
    const copy=element('div'); const title=element('button','title-button saved-title',item.title);title.addEventListener('click',() => showDetails(item));
    copy.append(title,element('p','saved-meta',typeName(item)+' · '+item.year));main.append(poster(item,'saved-thumb'),copy);
    const actions=element('div','saved-actions');const done=element('button','',item.done?'↶ Ещё не смотрел':'✓ Просмотрено');
    done.setAttribute('aria-label',(item.done?'Вернуть в посмотреть: ':'Отметить просмотренным: ')+item.title);
    done.addEventListener('click',() => {item.done=!item.done;persist();renderSaved();notify(item.done?'Отмечено как просмотренное':'Возвращено в «Посмотреть»');});
    const remove=element('button','','Удалить');remove.setAttribute('aria-label','Удалить: '+item.title);remove.addEventListener('click',() => toggleSaved(item));
    actions.append(done,remove);row.append(main,actions);$('#saved-items').append(row);
  });
}
function renderDetails(item, loading = false, error = '') {
  const grid=element('div','detail-grid');const copy=element('div','detail-copy');
  const title=element('h2','',item.title);title.id='dialog-title';
  copy.append(title,element('div','detail-meta',typeName(item)+' · '+item.year),element('div','detail-meta',metadata(item)));
  if(item.genre) copy.append(element('div','detail-meta',item.genre));
  if(item.rating) copy.append(element('div','detail-meta','Оценка '+(item.source==='OMDb'?'IMDb':'TVmaze')+': '+item.rating+' / 10'));
  if(item.director) copy.append(element('div','detail-meta','Режиссёр: '+item.director));
  if(item.actors) copy.append(element('div','detail-meta','В ролях: '+item.actors));
  const description=element('p','',loading?'Загружаем описание и подробности из OMDb…':error || item.description || 'У источника пока нет описания этой истории.');
  description.setAttribute('role','status');copy.append(description);
  if(error) {const retry=element('button','secondary','Повторить загрузку');retry.addEventListener('click',()=>showDetails(item));copy.append(retry);}
  const button=element('button','primary');button.dataset.saveId=item.id;button.addEventListener('click',() => toggleSaved(item));copy.append(button);
  const url=safeUrl(item.url);
  if(url) {const link=element('a','detail-source',item.kind==='movie'?'Подробнее на IMDb ↗':'Подробнее на TVmaze ↗');link.href=url;link.target='_blank';link.rel='noopener noreferrer';copy.append(link);}
  grid.append(poster(item,'detail-poster'),copy);$('#dialog-content').replaceChildren(grid);refreshSaveButtons();
}
async function showDetails(item) {
  const number=++detailNumber;
  const needsDetails=item.kind==='movie' && /^movie-tt\d+$/.test(item.id);
  const cached=detailsCache.get(item.id);
  if(cached) Object.assign(item,cached);
  renderDetails(item,needsDetails && !cached);
  if(!$('#details-dialog').open) $('#details-dialog').showModal();
  if(!needsDetails || cached) return;
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),15000);
  try {
    const data=await omdb({i:item.id.slice(6),plot:'full'},controller.signal);
    if(data.Response==='False') throw new Error('Подробности фильма не найдены.');
    const valid=value=>value && value!=='N/A'?value:'';
    const details={...item,source:'OMDb',description:valid(data.Plot),genre:valid(data.Genre),duration:parseInt(data.Runtime)||null,
      rating:valid(data.imdbRating),director:valid(data.Director),actors:valid(data.Actors)};
    detailsCache.set(item.id,details);Object.assign(item,details);
    const stored=saved.find(entry=>entry.id===item.id);
    if(stored) {Object.assign(stored,details,{done:stored.done});persist();renderSaved();}
    if(number===detailNumber && $('#details-dialog').open) renderDetails(item);
  } catch(error) {if(number===detailNumber && $('#details-dialog').open) renderDetails(item,false,error.message.startsWith('Ключ')||error.message.includes('лимит')?error.message:'Не удалось загрузить подробности. Проверьте соединение и повторите.');}
  finally {clearTimeout(timer);}
}
$('#search-form').addEventListener('submit',event => {event.preventDefault();search($('#query').value);});
$('#retry').addEventListener('click',() => search(lastQuery));
$('#load-more').addEventListener('click',loadMore);
$('#sort').addEventListener('change',renderResults);
document.querySelectorAll('[data-kind]').forEach(button => button.addEventListener('click',() => {
  kind=button.dataset.kind;
  document.querySelectorAll('[data-kind]').forEach(tab => {tab.classList.toggle('active',tab===button);tab.setAttribute('aria-pressed',String(tab===button));});
  if($('#results').getAttribute('aria-busy')!=='true') renderResults();
}));
document.querySelectorAll('[data-list]').forEach(button => button.addEventListener('click',() => {
  listFilter=button.dataset.list;
  document.querySelectorAll('[data-list]').forEach(tab => {tab.classList.toggle('active',tab===button);tab.setAttribute('aria-pressed',String(tab===button));});renderSaved();
}));
$('.dialog-close').addEventListener('click',() => $('#details-dialog').close());
$('#details-dialog').addEventListener('click',event => {if(event.target===$('#details-dialog')) {const rect=event.target.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom) event.target.close();}});
window.addEventListener('storage',event => {if(event.key===STORAGE_KEY) {saved=readSaved();renderSaved();refreshSaveButtons();}});
renderSaved();search($('#query').value);
