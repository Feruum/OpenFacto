import { motion, useReducedMotion, useScroll, useSpring, type HTMLMotionProps } from 'motion/react'

export function LandingReveal(props:HTMLMotionProps<'section'>) {
  const reduced=useReducedMotion()
  return <motion.section {...props} initial={reduced?false:{opacity:0,transform:'translateY(32px)'}} whileInView={{opacity:1,transform:'translateY(0px)'}} viewport={{once:false,amount:.12}} transition={{duration:reduced?0:.52,ease:[.22,1,.36,1]}}/>
}

export function LandingScrollProgress() {
  const {scrollYProgress}=useScroll()
  const reduced=useReducedMotion()
  const smooth=useSpring(scrollYProgress,{stiffness:220,damping:36,mass:.3})
  return <motion.div className="landing-scroll-progress" aria-hidden="true" style={{scaleX:reduced?scrollYProgress:smooth}}/>
}
