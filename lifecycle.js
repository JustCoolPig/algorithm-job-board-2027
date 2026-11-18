'use strict';
(() => {
  const norm=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  function deadlineAt(value) {
    const s=String(value||'').trim().replace(/^(?:截止(?:至)?|截至)\s*[:：]?\s*/,'');
    const m=s.match(/^(20\d{2})[-/年](\d{1,2})[-/月](\d{1,2})日?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if(!m)return null;
    const [y,month,day]=m.slice(1,4).map(Number), h=m[4]===undefined?23:Number(m[4]),min=m[5]===undefined?59:Number(m[5]),sec=m[6]===undefined?(m[4]===undefined?59:0):Number(m[6]);
    const check=new Date(Date.UTC(y,month-1,day));
    if(check.getUTCFullYear()!==y||check.getUTCMonth()!==month-1||check.getUTCDate()!==day||h>23||min>59||sec>59)return null;
    return Date.UTC(y,month-1,day,h,min,sec,m[4]===undefined?999:0)-8*3600000;
  }
  function status(job,group={},now=Date.now()) {
    const rows=(job.deadlineSources?.length?job.deadlineSources:job.deadline?[{value:job.deadline,source:'官网',scope:'岗位'}]:[]);
    const applicable=rows.filter(r=>r.appliesToJob===true||(!/待确认|待核实/.test(r.scope||'')&&r.source==='官网'));
    const dated=applicable.map(r=>({...r,at:deadlineAt(r.value)})).filter(r=>r.at!==null);
    const past=dated.filter(r=>r.at<now), future=dated.filter(r=>r.at>=now);
    const reopened=Date.parse(job.reopenedAt||'')||0;
    if(past.length&&!future.length&&Math.max(...past.map(r=>r.at))>reopened)return {state:'expired',kind:'job',label:'岗位已过期',reason:`${past[0].source}截止 ${past[0].value}`,evidence:past[0]};
    if(past.length&&future.length)return {state:'review',kind:'conflict',label:'截止日期有冲突',reason:'来源期限不一致，待确认延期或批次适用范围'};
    if(job.closed===true&&job.closureVerified===true&&!reopened)return {state:'expired',kind:'job',label:'岗位已关闭',reason:job.closureReason||'已核实该岗位关闭'};
    for(const w of group.recruitmentWindows||[]) {
      if(w.confirmed!==true||!['company','campaign'].includes(w.scope))continue;
      if(w.company&&norm(w.company)!==norm(job.company))continue;
      const applies=w.scope==='company'||w.jobKeys?.includes(`${job.company}|${job.id}`)||(w.plan&&norm(w.plan)===norm(job.plan));
      const at=deadlineAt(w.deadline), closed=w.closed===true||at!==null&&at<now;
      const closedAt=at??Date.parse(w.closedAt||'');
      const fresh=Math.max(reopened,Date.parse(job.published||'')||0);
      if(applies&&closed&&!(Number.isFinite(closedAt)&&fresh>closedAt))return {state:'expired',kind:w.scope,label:w.scope==='company'?'该公司当期招聘已结束':'所属批次已结束',reason:`${w.source||'已核来源'}：${w.deadline||w.reason||'已关闭'}；不影响后续新批次`,evidence:w};
    }
    if(rows.some(r=>{const at=deadlineAt(r.value);return at!==null&&at<now;}))return {state:'review',kind:'batch-unconfirmed',label:'表单批次已截止，岗位待核',reason:'批次截止尚未确认适用于此岗位，暂不自动隐藏'};
    return {state:'active',kind:'open-or-unknown',label:'未确认过期',reason:'截止未到或未注明；不代表已核实仍在招'};
  }
  function application(job,history,groupForCompany,accounts=[]) {
    const exact=history.find(r=>r.jobKey===`${job.company}|${job.id}`);
    if(exact)return {kind:'exact',label:'本岗位已投',record:exact};
    const sameGroup=history.filter(r=>groupForCompany(r.company)===groupForCompany(job.company));
    const title=norm(job.title);
    const sameTitle=sameGroup.find(r=>norm(r.company)===norm(job.company)&&norm(r.role)===title&&norm(r.plan)&&!/(未知|未注明|待核|不明)/.test(r.plan)&&norm(r.plan)===norm(job.plan));
    if(sameTitle)return {kind:'exact',label:'本岗位已投',record:sameTitle};
    const plan=s=>norm(s).replace(/^2027/,'');
    const knownPlan=s=>plan(s)&&!/(未知|未注明|待核|不明)/.test(String(s||''));
    const knownId=s=>s!==null&&s!==undefined&&String(s).trim()!=='';
    const account=accounts.find(r=>norm(r.company)&&norm(r.company)===norm(job.company)&&knownId(r.id)&&knownId(job.id)&&String(r.id)===String(job.id)&&knownPlan(r.plan)&&knownPlan(job.plan)&&plan(r.plan)===plan(job.plan)&&/已投|已提交/.test(r.status||''));
    if(account)return {kind:'account',label:`官网确认已投 · ${account.checked||'核验日期未显示'}`,record:account};
    const related=sameGroup.find(r=>{const role=norm(r.role);return role.length>=6&&(role===title||role.length>=8&&title.includes(role));});
    if(related)return {kind:'related',label:'同名/相关岗位已投，待核同岗',record:related};
    return sameGroup.length?{kind:'company',label:'本公司/集团已有投递',record:sameGroup[0]}:null;
  }
  window.JobLifecycle={deadlineAt,status,application};
})();
