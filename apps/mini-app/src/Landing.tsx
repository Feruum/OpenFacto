import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { LandingChat } from './LandingChat'
import { LandingProduct } from './LandingProduct'
import { LandingReveal, LandingScrollProgress } from './LandingMotion'
import { Mark } from './ui'
import { PixelLandscape } from './PixelLandscape'
import { ArrowRight, ArrowUpRight, BookOpen, Check, ChevronDown, FileText, Globe2, Menu, MessageSquare, X } from './icons'
import './Landing.css'

const stages = [
  { name: 'Соберите знания', kind: 'knowledge' as const, text: 'Добавьте FAQ и документы события. Команда выбирает, какие материалы опубликовать для участников.', detail: 'Программа · правила · регистрация' },
  { name: 'Проверьте ответы', kind: 'playground' as const, text: 'Задавайте вопросы в проверочной среде. Смотрите ответ, использованные источники и ход проверки.', detail: 'Вопрос → поиск → источник → ответ' },
  { name: 'Оставайтесь рядом', kind: 'inbox' as const, text: 'Если подтверждённого ответа нет, вопрос попадает к модератору. Команда видит, где нужна помощь человека.', detail: 'Входящие · модерация · обратная связь' },
] as const

export default function Landing() {
  const reduced=useReducedMotion()
  const cardMotion=(delay:number)=>({initial:reduced?false:{opacity:0,transform:"translateY(28px)"},whileInView:{opacity:1,transform:"translateY(0px)"},viewport:{once:false,amount:.15},transition:{duration:reduced?0:.48,delay:reduced?0:delay,ease:[.22,1,.36,1] as const}})
  const [stage, setStage] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => {
    document.title = 'Openfacto — у каждого ответа есть источник'
    document.documentElement.lang = 'ru'
  }, [])
  useEffect(()=>{
    if(!menuOpen)return
    const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!document.querySelector('.landing-header')?.contains(event.target))setMenuOpen(false)}
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setMenuOpen(false);document.querySelector<HTMLButtonElement>('.landing-mobile-menu')?.focus()}}
    document.addEventListener('pointerdown',outside)
    document.addEventListener('keydown',escape)
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)}
  },[menuOpen])
  return <div className="landing">
    <LandingScrollProgress/>
    <a className="landing-skip" href="#landing-main">К содержимому</a>
    <header className="landing-header">
      <a className="landing-brand" href="/welcome" aria-label="Openfacto — главная"><span className="landing-brand-mark"><Mark /></span><span>Openfacto</span></a>
      <button className="landing-mobile-menu" aria-label="Меню сайта" aria-expanded={menuOpen} aria-controls="landing-navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button>
      <nav id="landing-navigation" className={menuOpen ? 'is-open' : ''} aria-label="О продукте" onClick={() => setMenuOpen(false)}><a href="#features">Возможности <ChevronDown /></a><a href="#how-it-works">Как это работает</a><a href="#conversation">Диалог с ассистентом</a><a href="https://github.com/Feruum/OpenFacto#readme" target="_blank" rel="noreferrer">Документация <ArrowUpRight /></a><a className="landing-mobile-app" href="/?view=overview">Открыть приложение <ArrowRight /></a></nav>
      <div className="landing-header-actions"><a className="landing-login" href="/?view=overview">Войти</a><a className="landing-button" href="/?view=overview" aria-label="Открыть приложение"><span className="landing-header-cta-label">Открыть приложение</span><span className="landing-header-cta-short">В приложение</span><ArrowRight /></a></div>
    </header>
    <main id="landing-main" className="landing-main">
      <section className="landing-hero" aria-labelledby="landing-title">
        <PixelLandscape />
        <div className="landing-hero-copy">
          <h1 id="landing-title"><span>Дайте участникам ответы.</span><br /><span>А команде — время.</span></h1>
          <p className="landing-lead">Все знания вашего события —<br />в одном диалоге с Openfacto.</p>
          <div className="landing-actions"><a className="landing-button" href="/?view=overview">Начать работу <ArrowRight /></a><a className="landing-button landing-button-soft" href="#conversation">Задать вопрос <MessageSquare /></a></div>
        </div>
      </section>

      <LandingReveal className="landing-integrations" aria-label="Материалы и языки"><p>Всё, что знает ваша команда. Теперь доступно участникам.</p><div className="landing-integration-grid"><span><MessageSquare />Telegram</span><span><FileText />PDF</span><span><BookOpen />FAQ</span><span><Globe2 />Русский</span><span>Қазақша</span><span>RU ↔ KZ</span></div></LandingReveal>

      <LandingReveal className="landing-features" id="features" aria-labelledby="features-title">
        <div className="landing-centered-heading"><p className="landing-eyebrow">Меньше повторений. Больше общения.</p><h2 id="features-title">Пусть вопросы идут.<br />Ответы уже рядом.</h2><p>От первого «где регистрация?» до сложного вопроса по правилам.<br />Материалы события, участники и команда — в одном месте.</p></div>
        <div className="landing-feature-grid">
          <motion.article {...cardMotion(0.00)} className="landing-feature"><div className="landing-feature-visual landing-visual-docs" aria-hidden="true"><div className="landing-paper landing-paper-back"><FileText /><span>AGENDA.PDF</span><i /><i /><i /></div><div className="landing-paper"><BookOpen /><span>БАЗА ЗНАНИЙ</span><i /><i /><i /><b><Check /> Материалы события</b></div><span className="landing-pixel-plus">+</span></div><h3>Ваши материалы.<br />Его знания.</h3><p>FAQ, программа и правила события. Вы решаете, что опубликовать для участников.</p><a href="/?view=knowledge">Открыть базу знаний <ArrowUpRight /></a></motion.article>
          <motion.article {...cardMotion(0.08)} className="landing-feature"><div className="landing-feature-visual landing-visual-chat" aria-hidden="true"><div className="landing-mini-message">тіркелу қайда болады? ↗</div><div className="landing-mini-message is-answer"><span className="landing-mini-brand"><Mark /> Openfacto</span>Тіркелу негізгі холлда,<br />сағат 09:00-де.<i /></div><div className="landing-language-stamp">RU / KZ</div></div><h3>Спрашивают по-разному.<br />Смысл остаётся.</h3><p>Русский, казахский и смешанная речь. Проверьте свои формулировки в Playground.</p><a href="#conversation">Посмотреть диалог <ArrowUpRight /></a></motion.article>
          <motion.article {...cardMotion(0.16)} className="landing-feature"><div className="landing-feature-visual landing-visual-team" aria-hidden="true"><div className="landing-ticket"><span>ВОПРОС УЧАСТНИКА ↗</span><strong>Можно приехать позже?</strong><div><span className="landing-pixel-avatar">А</span><span>Нужна помощь<br /><b>организатора</b></span></div></div><span className="landing-ticket-square" /></div><h3>AI помогает.<br />Команда решает.</h3><p>Если данных мало или нужен особый случай, к диалогу подключается организатор.</p><a href="/?view=inbox">Открыть обращения <ArrowUpRight /></a></motion.article>
        </div>
      </LandingReveal>

      <LandingReveal className="landing-process" id="how-it-works" aria-labelledby="process-title">
        <div className="landing-section-heading"><p className="landing-eyebrow">01 / Как это работает</p><h2 id="process-title">Соберите знания.<br /><em>Запустите диалог.</em></h2><p>Начните с материалов вашего события.<br />Остальное проверьте на своих вопросах.</p></div>
        <div className="landing-process-layout">
          <div className="landing-steps" role="group" aria-label="Этап работы">{stages.map((item, index) => <button key={item.kind} aria-pressed={stage === index} onClick={() => setStage(index)}><span className="landing-step-number">0{index + 1}</span><span><strong>{item.name}</strong><span>{item.text}</span></span><span aria-hidden="true">↗</span></button>)}</div>
          <LandingProduct stage={stage}/>
        </div>
      </LandingReveal>

      <LandingReveal className="landing-conversation" id="conversation" aria-labelledby="conversation-title">
        <div className="landing-centered-heading"><p className="landing-eyebrow">02 / Поговорите с Openfacto</p><h2 id="conversation-title">Ваш вопрос.<br/><em>Ваш диалог.</em></h2><p>Спросите о мероприятии. Уточните детали. Продолжите разговор.</p></div>
        <LandingChat/>
      </LandingReveal>
      <LandingReveal className="landing-workspace" id="workspace" aria-labelledby="workspace-title"><div className="landing-section-heading"><p className="landing-eyebrow">03 / Для вашей команды</p><h2 id="workspace-title">Один кабинет.<br/>Всё мероприятие.</h2><p>Работайте с материалами, проверяйте ответы и помогайте участникам.</p></div><div className="landing-workspace-links"><a href="/?view=knowledge"><span className="landing-workspace-icon"><BookOpen/></span><div><h3>База знаний</h3><p>FAQ, программа и документы. Вы выбираете, что доступно участникам.</p></div><ArrowUpRight/></a><a href="/?view=playground"><span className="landing-workspace-icon"><MessageSquare/></span><div><h3>Playground</h3><p>Задавайте вопросы и смотрите, как ассистент использует ваши материалы.</p></div><ArrowUpRight/></a><a href="/?view=inbox"><span className="landing-workspace-icon"><Globe2/></span><div><h3>Обращения</h3><p>Вопросы, которым нужна помощь организатора. Вся переписка рядом.</p></div><ArrowUpRight/></a></div></LandingReveal>
      <LandingReveal className="landing-finale" aria-labelledby="finale-title"><span className="landing-finale-cross" aria-hidden="true">+</span><p className="landing-eyebrow">Следующее событие. Меньше рутины.</p><h2 id="finale-title">Больше события.<br /><em>Меньше «а где?».</em></h2><p>Начните с одного FAQ.<br />Дайте команде время на то, что действительно важно.</p><div className="landing-actions"><a className="landing-button" href="/?view=knowledge">Добавить первый источник <ArrowRight /></a><a className="landing-button landing-button-outline" href="/?view=playground">Открыть Playground <ArrowUpRight /></a></div></LandingReveal>
    </main>
    <footer className="landing-footer"><div className="landing-footer-inner"><a className="landing-footer-brand" href="/welcome" aria-label="Openfacto — главная"><Mark /><span>Openfacto</span></a><div className="landing-footer-column"><h3>Продукт</h3><a href="#features">Возможности</a><a href="#how-it-works">Как это работает</a><a href="#conversation">Диалог с ассистентом</a></div><div className="landing-footer-column"><h3>Рабочее пространство</h3><a href="/?view=knowledge">База знаний</a><a href="/?view=playground">Playground</a><a href="/?view=inbox">Обращения</a></div><div className="landing-footer-column"><h3>О проекте</h3><a href="https://github.com/Feruum/OpenFacto" target="_blank" rel="noreferrer">GitHub <ArrowUpRight /></a><a href="https://github.com/Feruum/OpenFacto#readme" target="_blank" rel="noreferrer">Документация <ArrowUpRight /></a><a href="/?view=overview">Открыть приложение <ArrowUpRight /></a></div><div className="landing-footer-bottom"><p>У каждого ответа есть источник.</p><span>Бурабай · <a href="/burabay-pixel-hero.LICENSE.txt" target="_blank" rel="noreferrer">Фото: Dots foto · CC BY-SA 4.0</a></span><a href="#landing-main">Наверх ↑</a></div></div></footer>
  </div>
}
