import { chromium } from 'playwright'
const OUT=process.env.OUT, T=process.env.TOKEN, B='http://127.0.0.1:3399'
const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1536,height:1024},deviceScaleFactor:2})
await ctx.addCookies([{name:'authToken',value:T,domain:'127.0.0.1',path:'/',expires:Math.floor(Date.now()/1000)+28800,httpOnly:false,secure:false,sameSite:'Lax'}])
await ctx.addInitScript(t=>{try{localStorage.setItem('authToken',t);localStorage.setItem('token',t);localStorage.setItem('user',JSON.stringify({id:1,userId:1,nome:'Marco Rovatti',tipo:'admin'}))}catch{}},T)
const p=await ctx.newPage()
await p.goto(B+'/kanban',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(4500)
await p.screenshot({path:`${OUT}/K_novo.png`})
await b.close()
