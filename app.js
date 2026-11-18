'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const storage = { get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }, set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { announce('浏览器无法保存本机记录；请检查存储空间或隐私设置。'); return false; } } };
  let data = { groups: [] }, publicData = { groups: [] }, visibleCount = 15, recordLimit = 40, activeTab = 'jobs';
  let personal = null;
  let exclusions = {items:[],canManage:false}, exclusionsReady = false, exclusionBusy = false, pendingCompany = null;
  const exclusionKey = 'algorithm-board-direct-exclusions-v1';
  let recordChanges = storage.get('algorithm-board-direct-records-v2', {added:[], edits:{}});
  if (!recordChanges || !Array.isArray(recordChanges.added) || !recordChanges.edits || typeof recordChanges.edits !== 'object') recordChanges = {added:[], edits:{}};
  let editRecordId = null, pendingJobKey = null;
  const recordExpanded = new Set();
  const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  const exclusionRules = window.CompanyExclusionRules;
  const groupKey = group => exclusionRules.normalize(group.name);
  const aliasesForGroup = group => exclusionRules.aliasesForGroup(group,publicData);
  const excludedNames = new Set();
  const excludedGroup = group => excludedNames.has(group.name);
  function refreshExcludedGroups() {
    excludedNames.clear();
    const isExcluded=exclusionRules.createMatcher(exclusions.items,publicData);
    if(exclusions.items.length)for(const group of data.groups)if(isExcluded(group))excludedNames.add(group.name);
    expirySummary=null;
  }
  const gradeNames = {A:'直接相关', 'B+':'方向相关', B:'条件备选'};
  const gradeLabel = job => gradeNames[gradeOf(job)] || '待确认';
  const knownCompanyGroups = new Map();
  const companyNames = new Map();
  const groupDisplayNames = new Map(),quotaGroupsByName=new Map();
  const displayCompany = name => groupDisplayNames.get(name)||name;
  const groupForCompany = company => {
    const aliases = data.companyAliases || {}, name = String(company || '');
    if(companyNames.has(name))return companyNames.get(name);
    const norm=normalize(name);
    const alias = aliases[name] || aliases[norm];
    const group=alias?String(alias):knownCompanyGroups.get(norm) || name || '公司未知';
    companyNames.set(name,group);return group;
  };
  const seedId = (row,index) => row.id ? `seed:${row.id}` : `seed:${index}:${normalize(row.company)}:${normalize(row.role)}:${String(row.date||'')}`;
  let historyCache=null, historySource=null, historyChanges=null;
  const historyRows = () => {
    if(historyCache&&historySource===personal?.history&&historyChanges===recordChanges)return historyCache;
    const seeds=(personal?.history || []).map((row,index)=>{const id=seedId(row,index);return {...row,...recordChanges.edits[id],_id:id};});
    const added=recordChanges.added.map(row=>({...row,...recordChanges.edits[row.id],_id:row.id}));
    const countKeys=rows=>{const counts=new Map();for(const row of rows)if(row.jobKey)counts.set(row.jobKey,(counts.get(row.jobKey)||0)+1);return counts;};
    const seedCounts=countKeys(seeds), addedCounts=countKeys(added);
    const matches=new Map(seeds.filter(row=>row.jobKey && seedCounts.get(row.jobKey)===1 && addedCounts.get(row.jobKey)===1).map(row=>[row.jobKey,row]));
    historySource=personal?.history;historyChanges=recordChanges;
    return historyCache=[...seeds.filter(row=>!matches.has(row.jobKey)),...added.map(row=>({...matches.get(row.jobKey),...row}))];
  };
  const recordsByCompany = new Map(), applicationCache = new Map(), jobDerived = new Map(), personalJobs = new Map(), quotaCache = new Map();
  let recordSource=null, lifecycleMinute=-1, expirySummary=null;
  const lifecycleCache = new Map();
  function refreshRecords() {
    const rows=historyRows();if(recordSource===rows)return;
    recordSource=rows;recordsByCompany.clear();applicationCache.clear();quotaCache.clear();
    for(const row of rows){const name=groupForCompany(row.company);if(!recordsByCompany.has(name))recordsByCompany.set(name,[]);recordsByCompany.get(name).push(row);}
  }
  const groupRecords = group => {refreshRecords();return recordsByCompany.get(group.name)||[];};
  const recordQuotaGroup = name => {
    if(!quotaGroupsByName.has(name))quotaGroupsByName.set(name,{name,jobs:[],applicationQuota:personal?.quotaExtras?.[name] || data.applicationQuotaExtras?.[name]});
    return quotaGroupsByName.get(name);
  };
  const quotaOf = group => {
    refreshRecords();
    const original=data.groups[group.index]||group,minute=Math.floor(Date.now()/60000),cached=quotaCache.get(group.name);
    if(cached&&cached.group===original&&cached.minute===minute)return cached.value;
    const value=window.ApplicationQuota.groupStatus(original,groupRecords(original));
    quotaCache.set(group.name,{group:original,minute,value});return value;
  };
  const applicationOf = job => {
    refreshRecords();const key=keyOf(job);
    if(!applicationCache.has(key))applicationCache.set(key,window.JobLifecycle.application(job,recordSource,groupForCompany,personal?.accounts||[]));
    return applicationCache.get(key);
  };
  const markedRecord = job => {const a=applicationOf(job);return a?.kind==='exact'?a.record:null;};
  function refreshLifecycle() {
    const minute=Math.floor(Date.now()/60000);
    if(minute!==lifecycleMinute){lifecycleMinute=minute;lifecycleCache.clear();expirySummary=null;}
  }
  const lifecycleOf = job => {
    refreshLifecycle();
    const key=keyOf(job);
    if(!lifecycleCache.has(key))lifecycleCache.set(key,window.JobLifecycle.status(job,jobsByKey.get(key)?.group));
    return lifecycleCache.get(key);
  };
  const applicationHTML = job => {const a=applicationOf(job);return a ? `<button class="applied-badge ${a.kind}" ${a.kind==='account'?`data-show-account="${esc(keyOf(job))}"`:`data-show-records="${esc(groupForCompany(job.company))}"`}>${esc(a.label)} · 查看记录</button>` : '';};
  const deadlineRows = job => Array.isArray(job.deadlineSources) && job.deadlineSources.length ? job.deadlineSources : job.deadline ? [{value:job.deadline,source:'现有岗位资料',scope:'适用范围待核实'}] : [];
  const deadlineText = job => {const rows=deadlineRows(job);return rows.length ? rows.map(row=>`${row.value || '未注明'}（${row.source || '来源待核实'} · ${row.scope || '适用范围待核实'}）`).join('；') : '未注明';};
  const favorites = new Set(storage.get('algorithm-board-direct-favorites-v1', []));
  const expanded = new Set(), jobsByKey = new Map();
  const keyOf = job => `${job.company || ''}|${job.id ?? ''}`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const plain = value => value == null || value === '' ? '未知' : typeof value === 'object' ? (Array.isArray(value) ? value.map(plain).join('\n') : Object.entries(value).map(([k,v]) => `${k}：${plain(v)}`).join('\n')) : String(value);
  const safeURL = url => { try { const parsed = new URL(url); return /^https?:$/.test(parsed.protocol) ? parsed.href : ''; } catch { return ''; } };
  const officialLink = (url, label = '官网查看') => safeURL(url) ? `<a class="button secondary" href="${esc(safeURL(url))}" target="_blank" rel="noopener noreferrer">${label}</a>` : '<span class="group-meta">官方入口未知</span>';
  const gradeOf = job => String(job.grade || '未知').trim();
  const doctoralLabels = {doctoral_program:'博士专项',required:'博士岗',explicit:'明确招博士',preferred:'博士优先'};
  const doctoralHiringOf = job => {
    const value=job.doctoralHiring;
    if(!value || !Object.hasOwn(doctoralLabels,value.kind) || !Array.isArray(value.evidence))return null;
    const evidence=value.evidence.filter(row=>row&&typeof row.quote==='string'&&row.quote.trim()&&typeof row.scope==='string'&&row.scope.trim()&&safeURL(row.url));
    return evidence.length?{kind:value.kind,label:doctoralLabels[value.kind],evidence}:null;
  };
  function jobPlanHTML(job,plan) {
    const doctoral=doctoralHiringOf(job);
    const planBadge=plan.label?`<span class="plan-badge ${esc(plan.type)}" title="${esc(plan.title)}">${esc(plan.label)}</span>`:'';
    if(!doctoral)return planBadge;
    return `${plan.type==='doctoral'?'':planBadge}<span class="doctoral-badge" title="${esc(doctoral.label)} · 官方依据见详情">${esc(doctoral.label)}</span>`;
  }
  function doctoralEvidenceHTML(job) {
    const doctoral=doctoralHiringOf(job);if(!doctoral)return '';
    return `<section class="detail-section doctoral-evidence"><h3>博士招聘依据 · ${esc(doctoral.label)}</h3>${doctoral.evidence.map(row=>`<p>${row.sourceType==='verified_summary'?'已核资格摘要':'官方原句'}：${esc(row.quote)}</p><p>适用范围：${esc(row.scope)} <a href="${esc(safeURL(row.url))}" target="_blank" rel="noopener noreferrer">查看官方依据</a></p>`).join('')}${doctoral.kind==='explicit'?'<p>学历范围包含博士，不代表博士专项或博士独立投递名额。</p>':''}</section>`;
  }
  const employerTypes = ['银行','央国企','事业单位','其他企业/机构','待核实'];
  const employerTypeOf = (job,group) => {
    const value=job.employerType ?? group.employerType;
    return employerTypes.includes(value) ? value : '待核实';
  };
  const groupEmployerType = group => {
    const original=data.groups[group.index] || group;
    const types=new Set((original.jobs || []).map(job=>employerTypeOf(job,original)));
    return original.employerType==='混合主体' || types.size>1 ? '混合主体' : [...types][0] || employerTypeOf({},original);
  };
  function employerEvidenceHTML(job,group) {
    const value=job.employerTypeEvidence ?? group.employerTypeEvidence;
    const rows=(Array.isArray(value)?value:value?[value]:[]).filter(row=>row&&typeof row==='object');
    return `<section class="detail-section"><h3>单位类型</h3><p>${esc(employerTypeOf(job,group))}</p>${rows.length ? `<details class="employer-evidence"><summary>分类依据</summary>${rows.map(row=>`<p>${esc(row.source || '来源待核实')}${row.reportedType?` · ${esc(row.reportedType)}`:''}${row.basis?`：${esc(row.basis)}`:''}${safeURL(row.url)?` <a href="${esc(safeURL(row.url))}" target="_blank" rel="noopener noreferrer">查看依据</a>`:''}</p>`).join('')}</details>` : '<p>暂无可核实的分类依据。</p>'}</section>`;
  }
  const score = job => ({ A: 3, 'B+': 2, B: 1 }[gradeOf(job)] || 0);
  const time = value => { const n = Date.parse(value); return Number.isFinite(n) ? n : null; };
  const personalJob = job => personalJobs.get(keyOf(job));
  const directionTypes = [
    ['多模态/视觉',/多模态|视觉|图像|视频|计算机视觉|\bCV\b|vision/i],
    ['大模型/后训练',/大模型|语言模型|后训练|预训练|强化学习|对齐|\bLLM\b|RLHF|SFT/i],
    ['Agent',/agent|智能体|工具调用/i],
    ['蒸馏/高效推理',/蒸馏|高效推理|推理优化|模型压缩|量化|剪枝|推理加速/i],
    ['机器学习/预测',/机器学习|预测|推荐|排序|搜索算法|数据挖掘|运筹|时序|风控/i]
  ];
  const cities = ['北京','上海','深圳','杭州','广州','成都','南京','武汉','西安','苏州','天津','合肥','重庆','长沙','郑州','济南','青岛','厦门','福州','珠海','东莞','佛山','无锡','宁波','大连','沈阳','长春','哈尔滨','石家庄','太原','南昌','昆明','贵阳','南宁','海口','香港','澳门','台北','新加坡','东京'];
  const categoriesOf = job => { const text=`${job.title || ''} ${plain(job.direction)}`;const hits=directionTypes.filter(([,regex])=>regex.test(text)).map(([label])=>label);return hits.length ? hits : ['其他算法']; };
  const citiesOf = job => {const text=plain(job.city);const hits=cities.filter(city=>text.includes(city));return hits.length ? hits : ['其他 / 未知'];};
  function branchesHTML(title, value) {
    const rows=Array.isArray(value)?value:[value];
    const fields=[['plan','招聘批次'],['grade','匹配等级'],['direction','岗位方向'],['city','城市'],['target','适合人群'],['fit','职责匹配'],['gap','资格缺口'],['pending','待核实'],['conditionSummary','资格说明'],['requirements','资格要求'],['qualification','资格要求'],['education','学历要求'],['experience','经验要求'],['condition','条件'],['summary','说明'],['status','状态'],['notes','备注']];
    return `<section class="detail-section"><h3>${esc(title)}</h3>${rows.map((row,index)=>{
      if(!row||typeof row!=='object')return `<p>${esc(plain(row))}</p>`;
      const name=row.title||row.role||row.name||row.branch||`资格分支 ${index+1}`;
      return `<details class="rule"><summary>${esc(name)}</summary>${fields.filter(([key])=>row[key]!==undefined&&row[key]!=='').map(([key,label])=>`<p><strong>${label}：</strong>${esc(key==='grade' ? (gradeNames[String(row[key]).trim()] || plain(row[key])) : plain(row[key]))}</p>`).join('')}${safeURL(row.url)?officialLink(row.url):''}</details>`;
    }).join('')}</section>`;
  }
  function applyPersonal() {
    const overrides = new Map((personal?.jobs || []).map(row => [row.key,row]));
    data = {...publicData,groups:publicData.groups.map(group => ({...group,
      applicationQuota:personal?.richGroups?.[group.name]?.applicationQuota || group.applicationQuota,
      employerTypeEvidence:personal?.richGroups?.[group.name]?.employerTypeEvidence || group.employerTypeEvidence,
      rules:personal?.groupRules?.[group.name] || group.rules || [],
      ordinary:personal?.groupOrdinary?.[group.name] || group.ordinary || [],
      jobs:(group.jobs || []).map(original => {const job={...original,company:original.company||group.name};const local=overrides.get(keyOf(job));if(local)for(const field of ['fit','gap','target','pending','direction','variants','employerTypeEvidence','closureReason','url','deadlineSources','doctoralHiring'])if(local[field]!==undefined)job[field]=local[field];return job;})
    }))};
    knownCompanyGroups.clear();companyNames.clear();groupDisplayNames.clear();quotaGroupsByName.clear();data.groups.forEach(group=>{quotaGroupsByName.set(group.name,group);groupDisplayNames.set(group.name,group.displayName||group.name);knownCompanyGroups.set(normalize(group.name),group.name);group.jobs.forEach(job=>knownCompanyGroups.set(normalize(job.company),group.name));});
    data.alternativeJobs=publicData.groups.flatMap(group=>(group.alternativeJobs||[]).map(original=>({...original,group:group.name}))).map(original=>{const job={...original};const local=overrides.get(keyOf(job));if(local)for(const field of ['fit','gap','target','pending','direction','variants','employerTypeEvidence','closureReason','url','deadlineSources','doctoralHiring'])if(local[field]!==undefined)job[field]=local[field];return job;});
    jobsByKey.clear();data.groups.forEach(group=>group.jobs.forEach(job=>jobsByKey.set(keyOf(job),{job,group})));
    for(const job of data.alternativeJobs){const group=data.groups.find(g=>g.name===job.group);if(group&&!jobsByKey.has(keyOf(job)))jobsByKey.set(keyOf(job),{job,group});}
    personalJobs.clear();for(const row of personal?.jobs||[])personalJobs.set(row.key,row);
    const searchAliases=new Map();for(const alias of Object.keys(data.companyAliases||{})){const name=groupForCompany(alias);if(!searchAliases.has(name))searchAliases.set(name,[]);searchAliases.get(name).push(alias);}
    jobDerived.clear();for(const {job,group} of jobsByKey.values())jobDerived.set(keyOf(job),{
      search:[group.name,group.displayName,...(searchAliases.get(group.name)||[]),job.company,job.title,job.city,doctoralHiringOf(job)?.label].join(' ').toLowerCase(),
      directions:categoriesOf(job),cities:citiesOf(job),grade:gradeOf(job),score:score(job),doctoral:!!doctoralHiringOf(job),
      published:time(job.published)??-Infinity,deadlines:deadlineRows(job).map(row=>window.JobLifecycle.deadlineAt(row.value)).filter(value=>value!==null)
    });
    historyCache=null;recordSource=null;refreshRecords();quotaCache.clear();lifecycleCache.clear();expirySummary=null;refreshExcludedGroups();
    $('asof').textContent=`数据截至 ${data.asOf || '未知'} · 官方信息可能更新`;
    $('employer-type-note').textContent=data.employerTypeNotes ? plain(data.employerTypeNotes) : '单位类型按招聘主体筛选；集团内可能包含不同类型，分类依据见岗位详情。暂无依据时标为待核实。';
  }
  function stateOf(job) {
    if (markedRecord(job)) return 'applied';
    const status = String(personalJob(job)?.actionStatus || '').trim();
    if (/^新投候选/.test(status)) return 'new';
    if (/^已投岗位|^已有投递|^暂不新投/.test(status)) return 'applied';
    return 'pending';
  }
  const stateLabel = job => ({new:'可新投',pending:'待核实',applied:'已有投递'}[stateOf(job)]);
  function announce(message) { $('message').textContent = message; $('message').hidden = false; }
  function setExclusions(value) {
    if(!value || !Array.isArray(value.items) || typeof value.canManage!=='boolean' || value.items.some(item=>!item || typeof item.groupKey!=='string' || typeof item.groupName!=='string' || !Array.isArray(item.aliases))) throw new Error('公司删除列表格式异常');
    exclusions=value;exclusionsReady=true;refreshExcludedGroups();renderExclusions();
  }
  function renderExclusions() {
    $('excluded-count').textContent=exclusionsReady?`(${exclusions.items.length})`:'';
    $('excluded-list').innerHTML=(exclusionsReady ? (exclusions.items.length ? exclusions.items.map(item=>`<div class="excluded-company"><div><strong>${esc(displayCompany(item.groupName))}</strong><small>集团范围：${esc(item.aliases.join('、'))}</small></div><button class="details-button" data-restore-company="${esc(item.groupKey)}" ${exclusionBusy?'disabled':''}>恢复</button></div>`).join('') : '<p>暂无已删除公司。</p>') : '<p>暂时无法读取已删除公司，岗位列表已暂停。</p><button class="details-button" data-retry-exclusions>重新读取</button>');
  }
  async function exclusionRequest(method='GET', item=null) {
    let items = storage.get(exclusionKey, []);
    if (method !== 'GET') {
      items = items.filter(row => row.groupKey !== item.groupKey);
      if (method === 'POST') items.push(item);
      if (!storage.set(exclusionKey, items)) throw new Error('无法保存本机设置。');
    }
    const result = {items, canManage:true};
    setExclusions(result);
    showCompanyPermission();
    return result;
  }
  async function readExclusions() {
    try {await exclusionRequest();renderJobs();return true;}
    catch(error) {exclusionsReady=false;renderExclusions();$('result-summary').textContent='岗位列表暂未加载';$('expiry-summary').textContent='';$('load-more').hidden=true;$('results').innerHTML='<div class="empty"><p>无法确认已删除公司的最新状态，岗位列表已暂停。</p><button class="button secondary" data-retry-exclusions>重新读取</button></div>';return false;}
  }
  function openCompanyDelete(index) {
    const group=data.groups[Number(index)];if(!group||!exclusionsReady)return;
    pendingCompany={groupKey:groupKey(group),groupName:group.name,aliases:aliasesForGroup(group)};
    openCompanyDialog();
  }
  function openCompanyDialog() {
    $('company-dialog-title').textContent=pendingCompany?'删除公司':'启用管理';
    $('company-scope').textContent=pendingCompany?`删除整个集团：${displayCompany(pendingCompany.groupName)}。关联名称：${pendingCompany.aliases.join('、')}。`:'启用后可删除和恢复公司。';
    $('company-delete-note').hidden=!pendingCompany;
    $('management-key').value='';$('company-error').hidden=true;showCompanyPermission();$('company-dialog').showModal();
  }
  function showCompanyPermission() {
    $('confirm-company-delete').disabled=exclusionBusy||!exclusions.canManage;
    $('confirm-company-delete').hidden=!pendingCompany;
    $('company-management').hidden=exclusions.canManage;
    $('enable-management').disabled=exclusionBusy;
    $('management-key').disabled=exclusionBusy;
  }
  async function changeCompany(method,item) {
    if(exclusionBusy)return;
    if(!exclusions.canManage) {if(method==='POST')showCompanyPermission();else {pendingCompany=null;openCompanyDialog();}return;}
    exclusionBusy=true;showCompanyPermission();renderExclusions();
    try {
      await exclusionRequest(method,item);
      if(method==='POST') {$('company-dialog').close();renderJobs();announce(`已已在此浏览器隐藏 ${displayCompany(item.groupName)}。`);}
      else {
        try {await readPublicData(true);applyPersonal();populateFilters();renderRecords();renderJobs();announce(`已恢复 ${displayCompany(item.groupName)}。`);}
        catch(error) {exclusionsReady=false;renderExclusions();$('results').innerHTML='<div class="empty"><p>公司已恢复，但岗位数据加载失败。</p><button class="button secondary" data-retry-exclusions>重新读取</button></div>';$('load-more').hidden=true;announce(`已恢复 ${item.groupName}；请重新读取岗位数据。`);}
      }
    } catch(error) {
      if(method==='POST') {$('company-error').textContent=error.message;$('company-error').hidden=false;showCompanyPermission();}
      else announce(`恢复失败：${error.message}`);
    } finally {exclusionBusy=false;showCompanyPermission();renderExclusions();}
  }
  function populateFilters() {
    for (const [field, id] of [['direction','direction'],['city','city']]) {
      const selected = $(id).value;$(id).innerHTML=`<option value="">${id==='city'?'全部城市':'全部方向'}</option>`;
      const values = field==='direction' ? [...directionTypes.map(([label])=>label),'其他算法'] : [...new Set(data.groups.flatMap(g=>g.jobs||[]).flatMap(citiesOf))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
      values.forEach(value => { const option = document.createElement('option'); option.value = value; option.textContent = value; $(id).append(option); });
      if(values.includes(selected))$(id).value=selected;
    }
  }
  function compareJobs(a,b,sort,now) {
    const x=jobDerived.get(keyOf(a)),y=jobDerived.get(keyOf(b));
    const published=y.published-x.published||0;
    if(sort==='fit')return y.score-x.score||published;
    if(sort==='deadline'){
      const next=meta=>Math.min(...meta.deadlines.filter(value=>value>=now));
      return next(x)-next(y)||published;
    }
    return published;
  }
  function sourceHTML(group) {
    return ['gank','feishu'].map(name=>{const source=group.sourceOrder?.[name];if(!source || source.rank==null)return '';const label=`${name==='gank'?'Gank':'飞书'} · 更新 ${source.date || '日期未注明'}`;return safeURL(source.url)?`<a href="${esc(safeURL(source.url))}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`:`<span>${esc(label)}</span>`;}).join(' ') || '<span>补充收录 · 无来源位置</span>';
  }
  function quotaHTML(group) {
    const status=quotaOf(group),quota=group.applicationQuota||{},rules=group.rules||[];
    const sharing={independent:'独立名额',shared:'与普通批共用',unknown:'是否占普通名额待核'};
    const limitKinds={cumulative:'累计投递上限',window:'当前批次 / 窗口上限',concurrent:'同时在流程上限',unknown:'上限性质待核'};
    const coverage=quota.coverage||{};
    return `<p class="quota-overview">${esc(status.summary)}</p>${status.statuses.map(({pool,recorded,unassigned,hasSnapshot,stale,changed})=>{
      const linked=rules.filter(rule=>(pool.ruleIds||[]).includes(rule.id));
      const evidence=[...new Set([...(pool.evidenceUrls||[]),...linked.map(rule=>rule.url)].map(safeURL).filter(Boolean))];
      const snapshot=hasSnapshot?`系统余 ${pool.remaining}（核验 ${pool.remainingAsOf}）${stale?` · ${changed?'后续投递记录有变化，待刷新':'历史快照，待刷新'}`:''}`:'剩余投递次数待核';
      return `<section class="detail-section quota-pool"><h3>${esc(pool.label||({ordinary:'普通批',talent:'人才 / 博士专项',shared:'普通 / 人才共享池'}[pool.planType]||'名额范围待核'))}</h3><p>${esc(snapshot)}</p><p>${esc(sharing[pool.sharing]||sharing.unknown)}${pool.sharingNote?`：${esc(plain(pool.sharingNote))}`:''}</p><p>适用范围：${esc(pool.scope||'待核')}${pool.planNames?.length?` · ${esc(pool.planNames.join(' / '))}`:''}</p><p>${Number.isInteger(pool.total)&&pool.total>=0?`${esc(pool.limitLabel||`${limitKinds[pool.limitKind]||limitKinds.unknown}：${pool.total}`)}`:'投递上限待核'}${recorded?` · 本池已记录 ${recorded} 条`:''}${unassigned?` · ${unassigned} 条记录池归属待核`:''}</p>${pool.notes?.length?`<p>${esc(plain(pool.notes))}</p>`:''}${linked.map(rule=>`<p>${esc(plain(rule.summary))}${rule.pending?` · 待核：${esc(plain(rule.pending))}`:''}</p>`).join('')}${safeURL(pool.entryUrl)?`<div class="quota-links">${officialLink(pool.entryUrl,pool.planType==='ordinary'?'普通招聘入口':pool.planType==='shared'?'招聘 / 专项入口':'人才 / 专项入口')}</div>`:''}${evidence.length?`<div class="quota-links">${evidence.map((url,index)=>`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">规则依据${evidence.length>1?` ${index+1}`:''}</a>`).join('')}</div>`:''}</section>`;
    }).join('')}${!status.statuses.length?'<p>普通批和人才专项的额度、入口均待核。</p>':''}${Object.entries(coverage).length?`<section class="detail-section"><h3>专项入口核查</h3>${Object.entries(coverage).map(([type,value])=>`<p>${esc({ordinary:'普通批',talent:'人才计划',doctoral:'博士专项'}[type]||type)}：${esc(plain(value))}</p>`).join('')}</section>`:''}${quota.coverageNote?`<p>${esc(plain(quota.coverageNote))}</p>`:''}<p class="notice">投递前先核实人才 / 博士专项入口；本机记录条数不代表系统剩余名额。</p>`;
  }
  function quotaDetail(index) {
    const group=data.groups[index];if(!group||excludedGroup(group))return;
    $('detail-title').textContent=`${displayCompany(group.name)} · 名额 / 专项入口`;
    $('detail-content').innerHTML=quotaHTML(group)+additionalQuotaRulesHTML(group);$('detail').showModal();
  }
  function recordQuotaDetail(name) {
    const group=recordQuotaGroup(name);
    $('detail-title').textContent=`${displayCompany(name)} · 名额 / 专项入口`;
    $('detail-content').innerHTML=quotaHTML(group)+additionalQuotaRulesHTML(group);$('detail').showModal();
  }
  function additionalQuotaRulesHTML(group) {
    const linked=new Set((group.applicationQuota?.pools||[]).flatMap(pool=>pool.ruleIds||[]));
    const rules=(group.rules||[]).filter(rule=>!rule.id||!linked.has(rule.id));
    return rules.length?`<section class="detail-section"><h3>其他投递规则</h3>${rules.map(rule=>`<div class="rule"><p>${esc(plain(rule.summary))}</p><p>适用范围：${esc(plain(rule.scope))}${rule.pending?` · 待核：${esc(plain(rule.pending))}`:''}</p>${safeURL(rule.url)?`<a href="${esc(safeURL(rule.url))}" target="_blank" rel="noopener noreferrer">查看规则</a>`:''}</div>`).join('')}</section>`:'';
  }
  function matchingGroups() {
    const query=$('search').value.trim().toLowerCase(),grade=$('grade').value,direction=$('direction').value,city=$('city').value,
      employerType=$('employer-type').value,favoritesOnly=$('favorites-only').checked,doctoralOnly=$('doctoral-only').checked,lifecycle=$('lifecycle').value,
      appliedOnly=$('company-applied').checked,status=$('status').value,sort=$('sort').value,now=Date.now();
    const compare=(a,b)=>compareJobs(a,b,sort,now);
    return data.groups.map((group, index) => ({...group, index, jobs:excludedGroup(group)?[]:[...(group.jobs||[]),...(favoritesOnly?data.alternativeJobs.filter(job=>job.group===group.name):[])].filter(job => {
      const meta=jobDerived.get(keyOf(job));
      return (!query || meta.search.includes(query)) &&
        (grade === 'all' || (grade === 'strong' ? ['A','B+'].includes(meta.grade) : grade === meta.grade)) &&
        (!direction || meta.directions.includes(direction)) && (!city || meta.cities.includes(city)) &&
        (!employerType || employerTypeOf(job,group)===employerType) && (!favoritesOnly || favorites.has(keyOf(job))) && (!doctoralOnly || meta.doctoral) &&
        (lifecycle==='all'||(lifecycle==='current'?lifecycleOf(job).state!=='expired':lifecycleOf(job).state===lifecycle)) &&
        (!appliedOnly||!!applicationOf(job)) && (!personal || !status || stateOf(job)===status);
    }).sort(compare).slice(0,10)})).filter(group => group.jobs.length).sort((a,b)=>compare(a.jobs[0],b.jobs[0])||a.index-b.index);
  }
  function jobHTML(job) {
    const key=keyOf(job),saved=favorites.has(key),life=lifecycleOf(job),application=applicationOf(job),plan=window.ApplicationQuota.jobPlan(job);
    const deadlines=deadlineRows(job), deadline=deadlines.find(r=>r.source==='官网')||deadlines.find(r=>window.JobLifecycle.deadlineAt(r.value)!==null)||deadlines[0];
    const dateLabel=deadline?`${deadline.source==='官网'?'截止':'批次截止'} ${deadline.value} · ${deadline.source||'来源待核'}`:'截止未注明';
    const city=String(job.city||'城市未注明').replace(/[（(].*?[)）]/g,'').trim()||'城市见详情';
    const compactStatus=life.state==='expired'?'已过期':life.state==='review'?'截止待核':'';
    const applied=application&&application.kind!=='company'?`<button class="applied-badge ${application.kind}" ${application.kind==='account'?`data-show-account="${esc(keyOf(job))}"`:`data-show-records="${esc(groupForCompany(job.company))}"`} title="${esc(application.label)}">${application.kind==='account'?esc(application.label):application.kind==='exact'?`已投 · ${esc(application.record.status||'状态未注明')}`:'相关岗位已投'}</button>`:'';
    return `<article class="job"><div class="job-main"><button class="job-title" data-detail="${esc(key)}">${esc(job.title||'岗位名称未知')}</button><div class="job-meta"><span title="${esc(job.city||'')}">${esc(city)}</span><span class="badge ${gradeOf(job)==='B'?'weak':''}">${esc(gradeLabel(job))}</span>${jobPlanHTML(job,plan)}${Number.isFinite(jobDerived.get(key)?.published)?`<span class="published">发布 ${esc(job.published)}</span>`:''}<span class="deadline" title="${esc(deadlineText(job))}">${esc(dateLabel)}</span>${compactStatus?`<span class="lifecycle-badge ${life.state}" title="${esc(life.reason)}">${compactStatus}</span>`:''}${applied}</div></div><div class="job-actions"><button class="save favorite ${saved?'saved':''}" data-save="${esc(key)}" aria-pressed="${saved}" aria-label="${saved?'取消收藏':'收藏岗位'}" title="${saved?'取消收藏':'收藏岗位'}">${saved?'★':'☆'}</button><button class="details-button" data-detail="${esc(key)}">详情</button>${application?.kind==='account'?`<button class="save" data-show-account="${esc(key)}">官网已投证据</button>`:`<button class="save" data-apply="${esc(key)}">${markedRecord(job)?'编辑记录':'记为已投'}</button>`}</div></article>`;
  }
  function renderJobs() {
    if(!exclusionsReady)return;
    const groups = matchingGroups(), count = groups.reduce((sum,g) => sum + g.jobs.length,0);
    // The lifecycle cache refreshes by minute; typing only updates matching rows and DOM.
    refreshLifecycle();
    if(!expirySummary){let expired=0,review=0;for(const group of data.groups)if(!excludedGroup(group))for(const job of group.jobs){const state=lifecycleOf(job).state;if(state==='expired')expired++;if(state==='review')review++;}expirySummary=`已过期 ${expired}　截止待核 ${review}`;}
    $('expiry-summary').textContent=expirySummary;
    $('source-sort-note').textContent = {published:'默认按官网岗位发布日期从新到旧排列；公司按当前匹配岗位中最新一条排序，发布日期未知的放后。官网更新日及表单更新日不代替发布日期。',fit:'按匹配程度排列，同等级优先显示官网发布较新的岗位。',deadline:'优先显示尚未截止且日期明确的岗位；截止未知或已过期的放后，批次是否适用仍须核实。'}[$('sort').value];
    $('result-summary').textContent = `${groups.length} 家公司　${count} 个岗位`;
    $('results').innerHTML = groups.length ? groups.slice(0,visibleCount).map(group => {
      const applied=groupRecords(group);
      const open = expanded.has(group.index), shown = open ? group.jobs : group.jobs.slice(0,3), rules = group.rules || [];
      const allExpired=data.groups[group.index]?.jobs.every(j=>lifecycleOf(j).state==='expired');
      return `<section class="group"><div class="group-header"><div class="company-heading"><h2>${esc(group.displayName||group.name||'公司名称未知')}</h2><span class="employer-badge">${esc(groupEmployerType(group))}</span>${group.jobs.some(doctoralHiringOf)?'<span class="doctoral-badge company-doctoral" title="当前匹配岗位包含有官方博士招聘依据的岗位">有博士岗位</span>':''}${applied.length?`<button class="applied-badge company" data-show-records="${esc(group.name)}">已投 ${applied.length} 条</button>`:''}${allExpired?'<span class="lifecycle-badge expired" title="仅当前收录岗位均过期，仍会检查新岗位">收录岗位已过期</span>':''}<button class="quota-summary" data-quota="${group.index}" aria-label="${esc(displayCompany(group.name))}：${esc(quotaOf(group).summary)}，展开名额规则与专项入口">${esc(quotaOf(group).summary)} <span aria-hidden="true">›</span></button></div><div class="group-controls"><span class="group-meta">共 ${group.jobs.length} 个岗位</span><button class="quiet delete-company" data-delete-company="${group.index}" aria-label="删除整个${esc(displayCompany(group.name))}集团">删除公司</button></div></div>${shown.map(jobHTML).join('')}${group.jobs.length>3?`<div class="group-bottom"><button class="details-button" data-expand="${group.index}" aria-expanded="${open}">${open?'收起':`再看 ${group.jobs.length-3} 个岗位`}</button></div>`:''}</section>`;
    }).join('') : '<div class="empty"><p>没有符合当前条件的岗位。</p><button class="button secondary" data-reset>清空筛选</button><p>也可以将匹配程度切换为“全部匹配程度”。</p></div>';
    $('load-more').hidden = visibleCount >= groups.length;
  }
  function detail(key) {
    const entry = jobsByKey.get(key); if (!entry) return;
    const {job,group} = entry, rules = group.rules || [];
    const section = (title,value) => `<section class="detail-section"><h3>${title}</h3><p>${esc(plain(value))}</p></section>`;
    $('detail-title').textContent = job.title || '岗位详情';
    $('detail-content').innerHTML = `<p class="detail-meta">${esc(job.company || group.name)}　${esc(job.city || '城市未知')}　<span class="badge">${esc(gradeLabel(job))}</span></p>` +
      employerEvidenceHTML(job,group) + doctoralEvidenceHTML(job) +
      `<section class="detail-section"><h3>截止日期与来源证据</h3>${deadlineRows(job).length ? deadlineRows(job).map(row=>`<p>${esc(row.value || '未注明')} · ${esc(row.source || '来源待核实')} · 适用范围：${esc(row.scope || '待核实')}${safeURL(row.url)?` <a href="${esc(safeURL(row.url))}" target="_blank" rel="noopener noreferrer">查看截止证据</a>`:''}</p>`).join('') : '<p>截止未注明，请核实当前在招状态与适用批次。</p>'}</section>` + section('岗位方向与招聘批次', `${plain(job.direction)}\n${plain(job.plan)}`) + section('职责匹配',job.fit) + section('资格缺口 / 待确认',job.gap) + (job.pending ? section('仍需核实',job.pending) : '') + section('适合人群',job.target) + (job.variants && (!Array.isArray(job.variants)||job.variants.length) ? branchesHTML('岗位变体 / 分支资格',job.variants) : '') +
      `<section class="detail-section"><h3>日期与性质</h3><dl class="date-list">${[['发布日期',job.published],['更新日期',job.updated],['招聘批次日期',job.campaignDate],['截止日期',job.deadline],['日期性质',job.dateType]].map(([label,value])=>`<dt>${label}</dt><dd>${esc(plain(value))}</dd>`).join('')}</dl></section>` +
      `<section class="detail-section"><h3>名额 / 专项入口</h3><details class="quota-rules"><summary>${esc(quotaOf(group).summary)}</summary>${quotaHTML(group)}${additionalQuotaRulesHTML(group)}</details></section>` +
      ((personalJob(job)?.actionStatus || personalJob(job)?.conditionSummary) ? section('关联筛选状态', `${plain(personalJob(job).actionStatus)}\n${plain(personalJob(job).conditionSummary)}`) : '') +
      (group.ordinary?.length ? branchesHTML('集团其他岗位 / 分支资格',group.ordinary) : '') +
      `<section class="detail-section"><h3>官方入口</h3>${officialLink(job.url)}<p class="group-meta">打开官方页面后请自行确认并提交申请。</p></section>`;
    $('detail-content').insertAdjacentHTML('afterbegin',`<section class="detail-section"><h3>招聘状态与投递记录</h3><p>${esc(lifecycleOf(job).label)}：${esc(lifecycleOf(job).reason)}</p>${applicationHTML(job)}</section><section class="detail-section"><h3>来源与匹配说明</h3><div class="source-position">${sourceHTML(group)}</div><p>${esc({A:'直接相关：核心研究或训练经验吻合，仍须核对硬要求。','B+':'方向相关：经验可迁移，存在领域或技能缺口。',B:'条件备选：与主线较远或资格待确认。'}[gradeOf(job)]||'匹配程度待确认')}</p></section>`);
    $('detail').showModal();
  }
  // Use the original registration time, never the last status-edit time.
  const recordCreatedTime = row => time(row.recordCreatedAt) ?? Number(/^added:(\d+):/.exec(row._id || row.id || '')?.[1] || 0);
  const compareRecords = (a,b) => (time(String(b.date || '').slice(0,10)) || 0) - (time(String(a.date || '').slice(0,10)) || 0) || recordCreatedTime(b) - recordCreatedTime(a) || b._recordOrder - a._recordOrder;
  function renderRecords() {
    const history=historyRows(), query=$('record-search').value.trim().toLowerCase(), filter=$('record-status').value;
    $('record-count').textContent=`(${history.length})`; $('status-label').hidden=false;
    $('private-note').textContent='已有投递按集团提示；资格与名额仍需核实。';
    const statuses=[...new Set(history.map(row=>String(row.status || '未注明')))];
    $('record-status').innerHTML='<option value="">全部状态</option>'+statuses.map(status=>`<option value="${esc(status)}">${esc(status)}</option>`).join('');
    if(statuses.includes(filter)) $('record-status').value=filter;
    const matches=history.map((row,index)=>({...row,_recordOrder:index})).filter(row=>(!query || `${row.company || ''} ${row.role || ''} ${groupForCompany(row.company)} ${displayCompany(groupForCompany(row.company))}`.toLowerCase().includes(query)) && (!filter || String(row.status || '未注明')===filter)).sort(compareRecords);
    const groups=new Map(); matches.forEach(row=>{const name=groupForCompany(row.company);if(!groups.has(name))groups.set(name,[]);groups.get(name).push(row);});
    const entries=[...groups.entries()];
    $('records').innerHTML=`<p class="notice" role="status">${matches.length} / ${history.length} 条记录 · ${groups.size} 家公司 · 显示 ${Math.min(recordLimit,groups.size)} 家</p><p class="notice">按最近投递由新到旧排列；同日按登记顺序，最新在前。</p>` + (entries.length ? entries.slice(0,recordLimit).map(([name,rows])=>{
      const dates=rows.map(r=>r.date).filter(Boolean).sort(), summary=[...new Set(rows.map(r=>r.role || '岗位未注明'))].join('；');
      return `<details class="record-group" data-record-group="${esc(name)}" ${recordExpanded.has(name)?'open':''}><summary><strong>${esc(displayCompany(name))}</strong><button class="record-quota-summary" data-record-quota="${esc(name)}" title="展开名额规则与专项入口">${esc(quotaOf(recordQuotaGroup(name)).summary)} ›</button><span>${rows.length} 条投递</span><span>最近 ${esc(dates.at(-1)||'未注明')}</span><span class="record-statuses">${esc([...new Set(rows.map(r=>r.status||'未注明'))].join(' / '))}</span><span class="record-role-summary" title="${esc(summary)}">${esc(summary)}</span></summary><div class="record-rows">${rows.map(row=>`<article class="record-row"><div><strong>${esc(row.role||'岗位未注明')}</strong><small>${esc(row.company)} · ${esc(row.plan||'批次未注明')}</small></div><div>${esc(row.date||'日期未注明')}<small>${esc(row.status||'状态未注明')}</small></div><p>${esc(row.notes||'')}</p><button class="details-button" data-edit-record="${esc(row._id)}">编辑</button></article>`).join('')}</div></details>`;
    }).join('') : '<p class="empty">没有符合条件的投递记录。</p>') + (recordLimit<groups.size ? '<div class="load-area"><button class="button secondary" data-more-records>再显示40家公司</button></div>' : '');
    document.querySelectorAll('[data-record-group]').forEach(el=>el.addEventListener('toggle',()=>{el.open?recordExpanded.add(el.dataset.recordGroup):recordExpanded.delete(el.dataset.recordGroup);}));
  }
  function openRecord(id=null,jobKey=null) {
    editRecordId=id;pendingJobKey=jobKey;const row=id?historyRows().find(r=>r._id===id):null, entry=jobsByKey.get(jobKey), form=$('record-form');
    form.reset();$('record-error').hidden=true;$('record-title').textContent=row?'编辑投递记录':'添加投递记录';
    for(const field of ['company','role','plan','date','status','notes']) form.elements[field].value=String(row?.[field] || (field==='company'?entry?.job.company:field==='role'?entry?.job.title:field==='plan'?entry?.job.plan:field==='date'?new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10):field==='status'?'已投递':'') || '');
    $('record-dialog').showModal();
  }
  $('record-search').addEventListener('input',()=>{recordLimit=40;renderRecords();});
  $('record-status').addEventListener('change',()=>{recordLimit=40;renderRecords();});
  $('add-record').addEventListener('click',()=>openRecord());
  $('close-record').addEventListener('click',()=>$('record-dialog').close());
  $('record-form').addEventListener('submit',event=>{
    event.preventDefault();const values=Object.fromEntries(new FormData(event.target));for(const key in values)values[key]=values[key].trim();
    if(!values.company || !values.role || !values.date || !values.status) return;
    values.recordUpdatedAt=new Date().toISOString();
    const duplicate=pendingJobKey && historyRows().find(row=>row.jobKey===pendingJobKey && row._id!==editRecordId);
    if(duplicate) {openRecord(duplicate._id,pendingJobKey);return;}
    const next=JSON.parse(JSON.stringify(recordChanges));
    if(editRecordId)next.edits[editRecordId]={...(next.edits[editRecordId]||{}),...values};
    else next.added.push({...values,recordCreatedAt:values.recordUpdatedAt,id:`added:${Date.now()}:${Math.random().toString(36).slice(2)}`,...(pendingJobKey?{jobKey:pendingJobKey}:{})});
    if(!storage.set('algorithm-board-direct-records-v2',next)) {$('record-error').textContent='保存失败：浏览器存储不可用，请检查隐私设置或存储空间后重试。';$('record-error').hidden=false;return;}
    recordChanges=next;$('record-dialog').close();renderRecords();renderJobs();announce('记录已保存。此操作不会提交招聘申请。');
  });
  $('export-records').addEventListener('click',()=>{const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),history:historyRows()},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob), link=document.createElement('a');link.href=url;link.download='投递记录备份.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  function resetFilters() { $('filters').reset(); visibleCount = 15; expanded.clear(); renderJobs(); }
  $('filters').addEventListener('submit', event => event.preventDefault());
  let searchTimer=null, composing=false;
  const applyFilters=()=>{clearTimeout(searchTimer);searchTimer=null;visibleCount=15;expanded.clear();renderJobs();};
  const scheduleSearch=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(applyFilters,120);};
  $('search').addEventListener('compositionstart',()=>{composing=true;clearTimeout(searchTimer);});
  $('search').addEventListener('compositionend',()=>{composing=false;scheduleSearch();});
  $('filters').addEventListener('input',event=>{
    if(event.target===$('search')){if(!composing&&!event.isComposing)scheduleSearch();}
    else applyFilters();
  });
  $('filters').addEventListener('reset', () => {clearTimeout(searchTimer);setTimeout(applyFilters,0);});
  $('load-more').addEventListener('click',()=> {visibleCount+=15;renderJobs();});
  $('close-detail').addEventListener('click',()=> $('detail').close());
  $('close-company').addEventListener('click',()=> {if(!exclusionBusy)$('company-dialog').close();});
  $('company-dialog').addEventListener('cancel',event=> {if(exclusionBusy)event.preventDefault();});
  $('confirm-company-delete').addEventListener('click',()=> {if(pendingCompany)changeCompany('POST',pendingCompany);});
  $('detail').addEventListener('click',event=> {if(event.target===$('detail')) {const r=$('detail').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('detail').close();}});
  document.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button) return;
    if(button.dataset.deleteCompany!==undefined)openCompanyDelete(button.dataset.deleteCompany);
    if(button.dataset.restoreCompany) {const item=exclusions.items.find(row=>row.groupKey===button.dataset.restoreCompany);if(item)changeCompany('DELETE',item);}
    if(button.hasAttribute('data-retry-exclusions'))retryBoard();
    if (button.dataset.showAccount) {const entry=jobsByKey.get(button.dataset.showAccount),a=entry&&applicationOf(entry.job);if(a?.kind==='account')window.alert(`官网账号投递证据\n${a.record.company} · ${a.record.title}\n项目：${a.record.plan}\n核验时间：${a.record.checked||'未显示'}\n${a.record.status}\n这是已有官网账号证据，未新增本地投递记录。`);}
    if (button.dataset.showRecords) {const name=button.dataset.showRecords;recordExpanded.add(name);$('record-search').value=name;$('record-status').value='';recordLimit=40;renderRecords();$('detail').close();document.querySelector('[data-tab="records"]').click();}
    if (button.dataset.detail) detail(button.dataset.detail);
    if (button.dataset.quota!==undefined) quotaDetail(Number(button.dataset.quota));
    if (button.dataset.recordQuota!==undefined) {event.preventDefault();recordQuotaDetail(button.dataset.recordQuota);}
    if (button.dataset.apply) {const record=markedRecord(jobsByKey.get(button.dataset.apply).job);openRecord(record?._id || null,button.dataset.apply);}
    if (button.dataset.editRecord) openRecord(button.dataset.editRecord);
    if (button.dataset.save) {const key=button.dataset.save;favorites.has(key)?favorites.delete(key):favorites.add(key);storage.set('algorithm-board-direct-favorites-v1',[...favorites]);renderJobs();}
    if (button.dataset.expand!==undefined) {const key=Number(button.dataset.expand);expanded.has(key)?expanded.delete(key):expanded.add(key);renderJobs();}
    if (button.hasAttribute('data-reset')) resetFilters();
    if (button.hasAttribute('data-more-records')) {recordLimit+=40;renderRecords();}
    if (button.dataset.tab) { activeTab=button.dataset.tab; $('jobs-page').hidden=activeTab!=='jobs';$('records-page').hidden=activeTab!=='records';document.querySelectorAll('[data-tab]').forEach(tab=>{tab.classList.toggle('active',tab.dataset.tab===activeTab);tab.setAttribute('aria-pressed',String(tab.dataset.tab===activeTab));}); }
  });
  async function readPublicData(force=false) {
    if(window.JOB_BOARD_DATA&&!force)publicData=window.JOB_BOARD_DATA;
    else {const response=await fetch('data.json',{cache:'no-store',credentials:'same-origin'});if(!response.ok)throw new Error(`HTTP ${response.status}`);publicData=await response.json();}
    if(!Array.isArray(publicData.groups))throw new Error('缺少 groups 数组');
    personal=storage.get('algorithm-board-direct-personal-v1', {jobs:[],history:[],accounts:[]});
  }
  async function retryBoard() {
    if(exclusionBusy)return;
    exclusionBusy=true;renderExclusions();
    try {await readPublicData(true);applyPersonal();populateFilters();renderRecords();await readExclusions();}
    catch(error) {exclusionsReady=false;renderExclusions();$('result-summary').textContent='岗位列表暂未加载';$('results').innerHTML='<div class="empty"><p>岗位数据暂时无法读取。</p><button class="button secondary" data-retry-exclusions>重新读取</button></div>';$('load-more').hidden=true;}
    finally {exclusionBusy=false;renderExclusions();}
  }
  async function init() {
    renderRecords();
    try {
      await readPublicData();
      applyPersonal();$('asof').textContent=`数据截至 ${data.asOf || '未知'} · 官方信息可能更新`;populateFilters();renderRecords();
      await readExclusions();
    }
    catch(error){$('asof').textContent='数据暂未载入';$('result-summary').textContent='';$('results').innerHTML='<div class="empty"><p>暂时无法读取岗位数据。</p><p>请刷新页面重试；若仍失败，请检查 data.json 是否可访问。</p><button class="button secondary" id="retry">重新加载</button></div>';$('retry').onclick=()=>location.reload();}
  }
  setInterval(()=>{if(data.groups.length)renderJobs();},60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&data.groups.length)renderJobs();});
  init();
})();
