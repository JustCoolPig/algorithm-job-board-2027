'use strict';
(() => {
  const norm=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  const integer=value=>Number.isInteger(value)&&value>=0;
  const plans=pool=>(Array.isArray(pool.planNames)?pool.planNames:[]).map(norm).filter(Boolean);
  const poolId=row=>row.quotaPoolId||row.applicationQuotaPoolId||'';
  function recordPool(row,pools,jobs=[]) {
    const explicit=poolId(row)||poolId(jobs.find(job=>row.jobKey&&row.jobKey===`${job.company}|${job.id}`)||{});
    if(explicit)return pools.find(pool=>pool.id===explicit)||null;
    const plan=norm(row.plan);
    if(!plan||/未知|未注明|待核|不明/.test(String(row.plan)))return null;
    const matched=pools.filter(pool=>plans(pool).includes(plan));
    return matched.length===1?matched[0]:null;
  }
  function timestamp(value) {
    const text=String(value||'');
    const at=Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(text)?`${text}T00:00:00+08:00`:text);
    return Number.isFinite(at)?at:null;
  }
  function systemEvidence(source) {
    if(source&&typeof source==='object')return source.verified!==false&&(source.kind==='system'||source.type==='system'||systemEvidence(source.source||source.label));
    const text=String(source||'');
    if(/未核|未查|未知|规则|FAQ|估计|推算|上限|not verified|unverified|estimate/i.test(text))return false;
    return /(?:系统|账户|账号|个人中心|我的申请).*(?:余额|余量|剩余|可投)|(?:system|account|portal).*balance/i.test(text);
  }
  function poolStatus(pool,records=[],pools=[pool],jobs=[],now=Date.now()) {
    const at=timestamp(pool.remainingAsOf),hasSnapshot=integer(pool.remaining)&&at!==null&&systemEvidence(pool.remainingSource);
    const snapshotDay=hasSnapshot?new Date(at+8*3600000).toISOString().slice(0,10):'';
    let recorded=0,unassigned=0,changed=false;
    for(const row of records) {
      const assigned=recordPool(row,pools,jobs);
      if(assigned?.id===pool.id)recorded++;
      if(!assigned)unassigned++;
      // A record in another confirmed independent pool cannot consume this pool.
      const independentOther=assigned&&assigned.id!==pool.id&&assigned.sharing==='independent'&&pool.sharing==='independent';
      const dateAt=timestamp(row.date),changedAt=timestamp(row.recordUpdatedAt);
      const appliedAt=changedAt===null?dateAt:Math.max(changedAt,dateAt??changedAt);
      const dateOnly=/^\d{4}-\d{2}-\d{2}$/.test(String(row.date||''));
      if(hasSnapshot&&!independentOther&&(appliedAt===null||appliedAt>=at||dateOnly&&row.date===snapshotDay))changed=true;
    }
    const stale=hasSnapshot&&(changed||now<at||now-at>=86400000);
    const remainingLabel=hasSnapshot?(stale?'余量待刷新':`系统余${pool.remaining}（${snapshotDay}）`):'余量待核';
    return {pool,recorded,unassigned,hasSnapshot,stale,changed,remainingLabel};
  }
  function summary(statuses) {
    if(!statuses.length)return '普通余量待核 · 人才待核';
    const label=s=>`${s.remainingLabel}${integer(s.pool.total)?`（${s.pool.limitKind==='concurrent'?'同时上限':s.pool.limitKind==='window'?'周期上限':'上限'}${s.pool.total}）`:''}`;
    const sharedNotice=statuses.some(s=>s.pool.sharing==='shared'||s.pool.planType==='shared')?' · 含共享名额':'';
    const hasBUScope=pool=>[pool.label,pool.scope].some(value=>String(value||'').split(/[；;。]/).some(part=>/\bBU\b|业务集团/i.test(part)&&!/未明|未单列|待核|未知|不明|未核|不推定|不外推|是否|待确认/.test(part)));
    if(statuses.some(s=>hasBUScope(s.pool)))return `按 BU 计额${sharedNotice} · ${statuses.some(s=>s.stale)?'余量待刷新':'余量待核'}`;
    const ordinary=statuses.filter(s=>s.pool.planType==='ordinary'),talent=statuses.filter(s=>s.pool.planType==='talent'),shared=statuses.filter(s=>s.pool.planType==='shared');
    if(shared.length&&statuses.length>1)return `部分计划共享 · ${statuses.map(s=>`${s.pool.label||'计划'}${label(s)}${s.pool.sharing==='shared'?'（共用）':s.pool.sharing==='independent'?'（独立）':'（共享待核）'}`).join(' · ')}`;
    if(statuses.length>2||ordinary.length>1||talent.length>1)return `按计划计额${sharedNotice} · ${statuses.some(s=>s.stale)?'余量待刷新':'余量待核'}`;
    if(shared.length===1&&statuses.length===1)return `普通 / 人才共用 · ${label(shared[0])}`;
    const parts=[];
    if(ordinary.length)parts.push(`普通${label(ordinary[0])}`);
    if(talent.length) {
      const s=talent[0],sharing=s.pool.sharing;
      parts.push(sharing==='shared'?`人才与普通批共用 · ${label(s)}`:sharing==='independent'?`人才独立 · ${label(s)}`:`人才${label(s)}（共享待核）`);
    } else parts.push('人才待核');
    if(!ordinary.length&&!shared.length)parts.unshift('普通余量待核');
    return parts.join(' · ');
  }
  function groupStatus(group,records=[],now=Date.now()) {
    const pools=Array.isArray(group.applicationQuota?.pools)?group.applicationQuota.pools:[];
    const statuses=pools.map(pool=>poolStatus(pool,records,pools,group.jobs||[],now));
    return {statuses,summary:summary(statuses),recorded:records.length};
  }
  function jobPlan(job) {
    const type=job.planType||job.planCoverage?.planType||'unknown';
    const text=String(job.plan||job.planName||'').trim();
    const label=type==='doctoral'?'博士专项':type==='talent'?'人才专项':type==='ordinary'?'普通批':text;
    return {type:['ordinary','talent','doctoral'].includes(type)?type:'unknown',label,title:text||label};
  }
  const api={recordPool,poolStatus,groupStatus,jobPlan};
  if(typeof window!=='undefined')window.ApplicationQuota=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
