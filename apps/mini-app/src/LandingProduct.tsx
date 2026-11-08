import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowRight, BookOpen, FileText, MessageSquare, MessagesSquare } from './icons'
import './LandingProduct.css'

const materials=[{Icon:FileText,title:'Программа события',text:'Расписание, площадки и выступления'},{Icon:FileText,title:'Правила участия',text:'Условия, ограничения и дедлайны'},{Icon:BookOpen,title:'Частые вопросы',text:'Регистрация, бейджи и контакты'}]
export function LandingProduct({stage}:{stage:number}) {
  const reduced=useReducedMotion()
  return <div className="landing-product-preview"><div className="landing-window-bar"><span/><span/><span/><b>Рабочее пространство</b></div><AnimatePresence mode="wait" initial={false}><motion.div key={stage} className="landing-product-stage" initial={reduced?false:{opacity:0,transform:'translateY(12px)'}} animate={{opacity:1,transform:'translateY(0px)'}} exit={{opacity:0,transform:'translateY(-8px)'}} transition={{duration:.2,ease:[.2,0,0,1]}}>
    {stage===0&&<><p className="landing-product-label">01 / База знаний</p><h3>Всё начинается<br/>с ваших материалов.</h3><div className="landing-product-files">{materials.map(({Icon,title,text})=><div key={title}><span><Icon/></span><div><strong>{title}</strong><p>{text}</p></div></div>)}</div><a href="/?view=knowledge">Добавить материалы <ArrowRight/></a></>}
    {stage===1&&<><p className="landing-product-label">02 / Проверка ответа</p><span className="landing-product-symbol"><MessageSquare/></span><h3>Задайте вопрос<br/>своими словами.</h3><p>Уточняйте детали и продолжайте разговор. Ассистент учитывает контекст диалога.</p><a href="#conversation">Перейти к диалогу <ArrowRight/></a></>}
    {stage===2&&<><p className="landing-product-label">03 / Работа команды</p><span className="landing-product-symbol"><MessagesSquare/></span><h3>Сложные вопросы —<br/>вашей команде.</h3><p>Организатор отвечает участнику, а полезный ответ можно сохранить в FAQ.</p><div className="landing-product-flow"><span>Вопрос</span><ArrowRight/><span>Организатор</span><ArrowRight/><span>Новый FAQ</span></div><a href="/?view=inbox">Открыть обращения <ArrowRight/></a></>}
  </motion.div></AnimatePresence></div>
}
