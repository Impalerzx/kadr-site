// 1. Находим элементы страницы через DOM.
const button = document.querySelector('#load');
const status = document.querySelector('#status');
const result = document.querySelector('#result');

// 2. Описываем асинхронную функцию и состояния запроса.
async function loadShow() {
  button.disabled = true;
  status.textContent = 'Загрузка…';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    // 3. Ждём HTTP-ответ и проверяем его статус.
    const response = await fetch('https://api.tvmaze.com/shows/1', {signal:controller.signal});
    if (!response.ok) throw new Error('HTTP ' + response.status);
    // 4. Превращаем JSON в объект JavaScript и выводим данные в DOM.
    const show = await response.json();
    status.textContent = 'Получен сериал: ' + show.name;
    result.textContent = JSON.stringify({id:show.id, name:show.name, genres:show.genres, premiered:show.premiered}, null, 2);
  } catch (error) {
    status.textContent = 'Не удалось загрузить данные. Проверьте интернет и повторите.';
    result.textContent = error.name === 'AbortError' ? 'Превышено время ожидания.' : error.message;
  } finally {
    clearTimeout(timer);
    button.disabled = false;
  }
}
// 5. Связываем действие пользователя и функцию.
button.addEventListener('click', loadShow);
