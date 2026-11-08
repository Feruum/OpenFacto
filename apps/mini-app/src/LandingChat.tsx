import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { appendConversation, type ConversationTurn, type Decision } from '@openfacto/answer-engine'
import type { Locale } from '@openfacto/contracts'
import { startSession } from './session'
import { events, liveEvent, organizations, type Question, type Session } from './workspace'
import { errorWord } from './api'
import { localize } from './i18n'
import { ArrowUpRight, BookOpen, MessageSquare, Plus, Send } from './icons'
import { Mark } from './ui'
import './LandingChat.css'

type Choice = { id: string; organizationId: string; name: string; organization: string }
type Connection = { kind: 'loading' | 'signed-out' | 'empty' } | { kind: 'error'; text: string } | { kind: 'ready'; session: Session; choices: Choice[] }
type Message = { id: string; role: 'user' | 'assistant'; text: string; decision?: Decision }
const suggestions = [
  { label: 'Где регистрация?', question: 'Где проходит регистрация?', language: 'ru' },
  { label: 'Бейджді қайдан аламын?', question: 'Бейджді қайдан аламын?', language: 'kk' },
  { label: 'Когда начало?', question: 'Когда начинается мероприятие?', language: 'ru' },
] as const

export function LandingChat() {
  const reduced = useReducedMotion()
  const [connection,setConnection] = useState<Connection>({kind:'loading'})
  const [attempt,setAttempt] = useState(0)
  const [selection,setSelection] = useState('')
  const [messages,setMessages] = useState<Message[]>([])
  const [draft,setDraft] = useState('')
  const [language,setLanguage] = useState<Locale>('ru')
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const controller = useRef<AbortController|null>(null)
  const conversation = useRef<ConversationTurn[]>([])
  const conversationAt = useRef(0)
  const retry = useRef<{ signature:string; input:Question; userId:string }|null>(null)
  const generation = useRef(0)
  const messageList = useRef<HTMLDivElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const choice = connection.kind==='ready' ? connection.choices.find(item=>item.id===selection) : undefined
  const token = connection.kind==='ready' ? connection.session.token : undefined
  const client = useMemo(()=>token&&choice ? liveEvent(token,choice.organizationId,choice.id) : undefined,[token,choice])

  useEffect(()=>{
    const lifetime={active:true}
    void (async()=>{
      try {
        const session=await startSession()
        if(!session){if(lifetime.active)setConnection({kind:'signed-out'});return}
        const available=(await organizations(session.token)).filter(org=>org.role!=='viewer')
        const groups=await Promise.all(available.map(async org=>(await events(session.token,org.id)).filter(event=>event.status==='active').map(event=>({id:event.id,organizationId:org.id,name:event.name,organization:org.name}))))
        if(!lifetime.active)return
        const choices=groups.flat()
        if(!choices.length){setConnection({kind:'empty'});return}
        const key='openfacto.scope.'+session.user.id
        const organization=sessionStorage.getItem(key)
        const preferred=sessionStorage.getItem(key+'.'+organization)
        setSelection(choices.find(item=>item.id===preferred&&item.organizationId===organization)?.id??choices[0]!.id)
        setConnection({kind:'ready',session,choices})
      } catch(e) {if(lifetime.active)setConnection({kind:'error',text:localize('ru')(errorWord(e))})}
    })()
    return()=>{lifetime.active=false}
  },[attempt])
  useEffect(()=>()=>{generation.current++;controller.current?.abort()},[])
  useEffect(()=>{if(messages.length||busy){const list=messageList.current;list?.scrollTo({top:list.scrollHeight,behavior:reduced?'auto':'smooth'})}},[messages,busy,reduced])

  function reset() {
    generation.current++;controller.current?.abort();retry.current=null
    conversation.current=[];conversationAt.current=0
    setMessages([]);setDraft('');setError('');setBusy(false)
  }
  function selectEvent(id:string) {
    if(connection.kind!=='ready')return
    const event=connection.choices.find(item=>item.id===id)
    if(!event)return
    reset();setSelection(id)
    const key='openfacto.scope.'+connection.session.user.id
    sessionStorage.setItem(key,event.organizationId)
    sessionStorage.setItem(key+'.'+event.organizationId,event.id)
  }
  async function send(question=draft,answerLanguage=language) {
    const text=question.trim()
    if(!client||busy||!text||text.length>2000)return
    const current=++generation.current
    const request=new AbortController();controller.current=request
    const signature=JSON.stringify([selection,text,answerLanguage])
    const previous=retry.current?.signature===signature?retry.current:null
    const history=Date.now()-conversationAt.current<10*60_000?conversation.current:[]
    const job=previous??{signature,input:{question:text,language:answerLanguage,mode:'published_preview' as const,faqOnly:false,conversation:history,requestId:crypto.randomUUID()},userId:crypto.randomUUID()}
    retry.current=job
    if(!previous)setMessages(items=>[...items,{id:job.userId,role:'user',text}])
    setBusy(true);setError('');setDraft('');setLanguage(answerLanguage)
    try {
      const decision=await client.playground(job.input,request.signal)
      if(generation.current!==current)return
      setMessages(items=>[...items,{id:crypto.randomUUID(),role:'assistant',text:decision.answer,decision}])
      if(['approved_faq','grounded_answer','clarify'].includes(decision.outcome)) {
        conversation.current=appendConversation(job.input.conversation??[],text,decision.answer)
        conversationAt.current=Date.now()
      } else {conversation.current=[];conversationAt.current=0}
      retry.current=null
    } catch(e) {
      if(generation.current!==current||request.signal.aborted)return
      setError(localize('ru')(errorWord(e)));setDraft(text)
    } finally {if(generation.current===current){setBusy(false);requestAnimationFrame(()=>input.current?.focus({preventScroll:true}))}}
  }
  function submit(event:FormEvent) {event.preventDefault();void send()}

  return <div className="landing-chat">
    <header className="landing-chat-header"><div className="landing-chat-brand"><span><Mark/></span><div><strong>Openfacto</strong><p>{choice?.name??'Диалог о вашем событии'}</p></div></div><button type="button" className="landing-chat-reset" onClick={reset} disabled={busy||!messages.length} aria-label="Новый диалог"><Plus/><span>Новый диалог</span></button></header>
    {connection.kind==='ready'&&connection.choices.length>1&&<div className="landing-chat-scope"><label>Мероприятие<select aria-label="Мероприятие для диалога" value={selection} disabled={busy} onChange={e=>selectEvent(e.target.value)}>{connection.choices.map(item=><option key={item.id} value={item.id}>{item.organization} · {item.name}</option>)}</select></label></div>}
    <div ref={messageList} className="landing-chat-messages" role="log" aria-label="Переписка с Openfacto" aria-live="polite" aria-relevant="additions text">
      {connection.kind==='loading'&&<div className="landing-chat-empty" role="status"><MessageSquare/><h3>Открываем диалог…</h3></div>}
      {connection.kind==='signed-out'&&<div className="landing-chat-empty"><MessageSquare/><h3>Ваше событие. Ваши вопросы.</h3><p>Войдите, чтобы поговорить с ассистентом по материалам вашего мероприятия.</p><a className="landing-button" href="/?view=overview">Открыть приложение <ArrowUpRight/></a></div>}
      {connection.kind==='empty'&&<div className="landing-chat-empty"><BookOpen/><h3>Начните с материалов события</h3><p>Создайте мероприятие и опубликуйте FAQ или документы.</p><a className="landing-button" href="/?view=knowledge">Открыть базу знаний <ArrowUpRight/></a></div>}
      {connection.kind==='error'&&<div className="landing-chat-empty" role="alert"><MessageSquare/><h3>Не удалось открыть диалог</h3><p>{connection.text}</p><button className="landing-button" onClick={()=>{setConnection({kind:'loading'});setAttempt(value=>value+1)}}>Попробовать снова</button></div>}
      {connection.kind==='ready'&&!messages.length&&<div className="landing-chat-empty"><span className="landing-chat-spark"><Mark/></span><h3>С чего начнём?</h3><p>Спросите про регистрацию, программу<br/>или условия участия.</p><div className="landing-chat-suggestions">{suggestions.map(item=><button key={item.label} disabled={busy} onClick={()=>void send(item.question,item.language)}>{item.label}<ArrowUpRight/></button>)}</div></div>}
      <AnimatePresence initial={false}>{messages.map(message=><motion.div key={message.id} className={`landing-chat-message is-${message.role}`} initial={reduced?false:{opacity:0,transform:'translateY(12px)'}} animate={{opacity:1,transform:'translateY(0px)'}} transition={{duration:.24,ease:[.2,0,0,1]}}>{message.role==='assistant'&&<span className="landing-chat-avatar"><Mark/></span>}<div className="landing-chat-bubble"><p>{message.text}</p>{Boolean(message.decision?.sources.length)&&<details className="landing-chat-sources"><summary>Материалы к ответу</summary>{message.decision!.sources.map((source,i)=><div key={source.versionId+'/'+i}><strong>{source.title}{source.page?` · стр. ${source.page}`:''}</strong>{source.quote&&<p>{source.quote}</p>}</div>)}</details>}</div></motion.div>)}</AnimatePresence>
      {busy&&<div className="landing-chat-message is-assistant"><span className="landing-chat-avatar"><Mark/></span><div className="landing-chat-typing" role="status" aria-label="Openfacto готовит ответ"><i/><i/><i/></div></div>}
      {error&&<div className="landing-chat-error" role="alert"><p>{error}</p><button disabled={busy} onClick={()=>void send()}>Повторить запрос</button></div>}
    </div>
    <form ref={form} className="landing-chat-composer" onSubmit={submit}>
      <textarea ref={input} aria-label="Ваш вопрос" placeholder="Спросите о мероприятии…" maxLength={2000} rows={2} value={draft} disabled={!client||busy} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();form.current?.requestSubmit()}}}/>
      <div className="landing-chat-composer-bar"><label><span>Язык ответа</span><select aria-label="Язык ответа" value={language} disabled={busy} onChange={e=>setLanguage(e.target.value as Locale)}><option value="ru">Русский</option><option value="kk">Қазақша</option><option value="en">English</option></select></label><button type="submit" disabled={!client||busy||!draft.trim()} aria-label="Отправить вопрос"><Send/></button></div>
    </form>
  </div>
}
