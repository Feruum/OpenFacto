import { useEffect, useState } from 'react'
import { GenerativeArt, type ArtKind } from './GenerativeArt'
import { Mark } from './ui'
import './Landing.css'

const scenes = [
  { kind: 'terrain', name: 'Рельеф', caption: 'У каждого события — свой ландшафт знаний.' },
  { kind: 'playground', name: 'Диалог', caption: 'Разные формулировки. Общий смысл.' },
  { kind: 'inbox', name: 'Связи', caption: 'Участники, знания и команда — рядом.' },
] as const satisfies readonly { kind: ArtKind; name: string; caption: string }[]
const examples = [
  { label: 'Русский', question: 'чо где проходит рега?', answer: 'Регистрация — в главном холле, с 09:00. Там же можно получить бейдж.', source: 'FAQ → Регистрация', quote: 'Регистрация участников и выдача бейджей проходят в главном холле с 09:00.' },
  { label: 'Қазақша', question: 'тіркелу қайда болады?', answer: 'Тіркелу негізгі холлда сағат 09:00-де басталады. Бейджді де сол жерден ала аласыз.', source: 'FAQ → Тіркелу', quote: 'Қатысушыларды тіркеу және бейдж беру негізгі холлда сағат 09:00-де басталады.' },
  { label: 'Смешанная речь', question: 'бейджді где аламын?', answer: 'Бейдж можно получить в главном холле, на стойке регистрации. Она открывается в 09:00.', source: 'FAQ → Регистрация', quote: 'Регистрация участников и выдача бейджей проходят в главном холле с 09:00.' },
  { label: 'Нет в источниках', question: 'будет трансфер из аэропорта?', answer: 'В материалах этого примера нет информации о трансфере. Такой вопрос нужно передать организатору.', source: 'Нужен организатор', quote: 'Ответа в демонстрационных источниках нет. Условия трансфера не предполагаем.' },
] as const
const stages = [
  { name: 'Соберите знания', kind: 'knowledge' as const, text: 'Добавьте FAQ и документы события. Команда выбирает, какие материалы опубликовать для участников.', detail: 'Программа · правила · регистрация' },
  { name: 'Проверьте ответы', kind: 'playground' as const, text: 'Задавайте вопросы в проверочной среде. Смотрите ответ, использованные источники и ход проверки.', detail: 'Вопрос → поиск → источник → ответ' },
  { name: 'Оставайтесь рядом', kind: 'inbox' as const, text: 'Если подтверждённого ответа нет, вопрос попадает к модератору. Команда видит, где нужна помощь человека.', detail: 'Входящие · модерация · обратная связь' },
] as const

export default function Landing() {
  const [scene, setScene] = useState(0)
  const [relief, setRelief] = useState(55)
  const [example, setExample] = useState(0)
  const [stage, setStage] = useState(0)
  const active = examples[example] ?? examples[0]
  const activeScene = scenes[scene] ?? scenes[0]
  const activeStage = stages[stage] ?? stages[0]
  useEffect(() => {
    document.title = 'Openfacto — у каждого ответа есть источник'
    document.documentElement.lang = 'ru'
  }, [])
  return <div className="landing">
    <a className="landing-skip" href="#landing-main">К содержимому</a>
    <header className="landing-header">
      <a className="landing-brand" href="/welcome" aria-label="Openfacto — главная"><Mark /><span>Openfacto</span></a>
      <nav aria-label="О продукте"><a href="#how-it-works">Как это работает</a><a href="#conversation">Пример ответа</a></nav>
      <a className="landing-link" href="/?view=overview">Открыть приложение <span aria-hidden="true">↗</span></a>
    </header>
    <main id="landing-main" className="landing-main">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero-copy">
          <p className="landing-eyebrow"><span /> Знания вашего события. В одном диалоге.</p>
          <h1 id="landing-title">Хороший ответ<br />начинается<br />с <em>источника.</em></h1>
          <p className="landing-lead">Участники спрашивают по-разному.<br />Соберите материалы события, проверяйте ответы и подключайте команду там, где нужна помощь.</p>
          <div className="landing-actions"><a className="landing-button" href="/?view=overview">Открыть Openfacto <span aria-hidden="true">↗</span></a><a href="#conversation">Посмотреть пример <span aria-hidden="true">↓</span></a></div>
          <div className="landing-hero-note"><span>01 / 03</span><p>Меньше повторяющихся вопросов.<br />Больше внимания к людям.</p></div>
        </div>
        <div className="landing-atlas">
          <div className="landing-atlas-top"><span>АТЛАС ЗНАНИЙ</span><span>OF / {String(scene + 1).padStart(2, '0')}</span></div>
          <div className="landing-atlas-art"><GenerativeArt kind={activeScene.kind} relief={relief} /></div>
          <div className="landing-atlas-caption"><span className="landing-cross" aria-hidden="true">+</span><p>{activeScene.caption}</p></div>
          <div className="landing-atlas-controls">
            <div className="landing-scene-buttons" role="group" aria-label="Вид иллюстрации">{scenes.map((item, index) => <button key={item.kind} type="button" aria-pressed={scene === index} onClick={() => setScene(index)}>{item.name}</button>)}</div>
            {scene === 0 && <label className="landing-range">Высота рельефа<input type="range" min="0" max="100" value={relief} onChange={(e) => setRelief(Number(e.target.value))} /></label>}
          </div>
        </div>
      </section>

      <div className="landing-principles"><span>Для конференций, форумов и встреч</span><span>Ответы с источниками</span><span>Команда остаётся в диалоге</span></div>

      <section className="landing-process" id="how-it-works" aria-labelledby="process-title">
        <div className="landing-section-heading"><p className="landing-eyebrow">01 — От материалов к ответу</p><h2 id="process-title">Ваши знания.<br /><em>Понятный путь.</em></h2><p>Сначала источник. Затем ответ.<br />А если данных мало — помощь команды.</p></div>
        <div className="landing-process-layout">
          <div className="landing-steps" role="group" aria-label="Этап работы">{stages.map((item, index) => <button key={item.kind} aria-pressed={stage === index} onClick={() => setStage(index)}><span className="landing-step-number">0{index + 1}</span><span><strong>{item.name}</strong><span>{item.text}</span></span><span aria-hidden="true">↗</span></button>)}</div>
          <div className={`landing-process-art landing-process-art--${activeStage.kind}`} aria-live="polite"><span className="landing-eyebrow">0{stage + 1} / {activeStage.name}</span><GenerativeArt kind={activeStage.kind} /><p>{activeStage.detail}</p></div>
        </div>
      </section>

      <section className="landing-conversation" id="conversation" aria-labelledby="conversation-title">
        <div className="landing-section-heading"><p className="landing-eyebrow">02 — По-человечески</p><h2 id="conversation-title">Вопросы разные.<br /><em>Источник один.</em></h2><p>Посмотрите, как может выглядеть диалог на русском, казахском и смешанной речи.</p></div>
        <div className="landing-demo">
          <div className="landing-demo-top"><span>Пример · Alatau Summit</span><span className="landing-demo-label">Демонстрация, не живой AI</span></div>
          <div className="landing-example-buttons" role="group" aria-label="Пример вопроса">{examples.map((item, index) => <button key={item.label} aria-pressed={example === index} onClick={() => setExample(index)}>{item.label}</button>)}</div>
          <div className="landing-dialogue" aria-live="polite" aria-atomic="true">
            <div className="landing-question"><span>Участник</span><p>{active.question}</p></div>
            <div className="landing-answer"><div className="landing-answer-name"><Mark />Openfacto</div><p>{active.answer}</p><span className="landing-source-tag">{example === 3 ? '↗' : '↳'} {active.source}</span></div>
            <details key={example} className="landing-evidence"><summary>{example === 3 ? 'Почему нужен организатор' : 'Посмотреть основание ответа'}</summary><p>{active.quote}</p></details>
          </div>
          <p className="landing-demo-footnote">Здесь показаны заранее подготовленные примеры. Ответы на ваши вопросы можно проверить в приложении после добавления материалов.</p>
        </div>
      </section>

      <section className="landing-finale" aria-labelledby="finale-title"><GenerativeArt kind="settings" /><div><p className="landing-eyebrow">03 — Начните со своего события</p><h2 id="finale-title">Всё начинается<br />с одного <em>вопроса.</em></h2><a className="landing-button landing-button-light" href="/?view=knowledge">Открыть базу знаний <span aria-hidden="true">↗</span></a></div></section>
    </main>
    <footer className="landing-footer"><a className="landing-brand" href="/welcome"><Mark /><span>Openfacto</span></a><p>У каждого ответа есть источник.</p><a href="/?view=overview">В приложение ↗</a></footer>
  </div>
}
