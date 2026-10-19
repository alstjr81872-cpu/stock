import {test,expect,type Page} from '@playwright/test';
async function login(page:Page){await page.goto('/');await page.getByRole('button',{name:'로컬 개발 계정으로 둘러보기'}).click();await expect(page.getByRole('heading',{name:'이야기를 이어갈 시간이에요.'})).toBeVisible();}
async function consent(page:Page){await page.getByRole('checkbox',{name:'전송 범위와 실행 한도를 확인했습니다.'}).check();await page.getByRole('button',{name:'확인하고 실행',exact:true}).click();}
test('landing is accessible and fits mobile, without manuscript cache',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');
 await expect(page.getByRole('heading',{name:'마음속의 이야기를, 한 편의 작품으로.'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
 expect(await page.evaluate(()=>localStorage.length)).toBe(0);
});
test('real Auth emulator login, style approval, upload, interview and saved planning',async({page})=>{
 const styleName='브라우저 검증 문체 '+Date.now(),projectName='비 오는 밤의 기록관 '+Date.now();
 await login(page);await page.getByRole('button',{name:'문체 라이브러리',exact:true}).click();
 await page.getByRole('button',{name:'새 문체 만들기',exact:true}).click();
 const create=page.getByRole('dialog');await create.getByLabel('문체 이름').fill(styleName);
 await create.getByLabel('떠오르는 문체 선호').fill('가까운 3인칭. 대사는 경쾌하고 감정의 여운을 지킨다. 문장은 자연스럽게 변주하고 번역투와 반복 설명을 피한다.');
 await create.getByRole('button',{name:'문체 초안 만들기'}).click();
 await expect(page.getByRole('heading',{name:styleName,exact:true})).toBeVisible();
 await page.getByRole('button',{name:'분석 · 샘플 생성',exact:true}).click();await consent(page);
 await expect(page.getByRole('button',{name:'B · 경쾌한 내면'})).toBeVisible();await page.getByRole('button',{name:'B · 경쾌한 내면'}).click();
 await page.getByRole('checkbox',{name:/A\/B\/C를 비교/}).check();await page.getByRole('button',{name:'문체 승인 · 버전 고정'}).click();await expect(page.getByRole('button',{name:'승인된 버전',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'홈',exact:true}).click();await page.getByRole('button',{name:'새 작품 기획하기'}).click();
 await page.getByLabel('작품 가제').fill(projectName);
 await page.getByLabel('아이디어 TXT 파일').setInputFiles({name:'idea.txt',mimeType:'text/plain',buffer:Buffer.from('현대 판타지. 성인 기록관은 사라진 약속을 찾는다.\n큰 성장에는 대가와 여운이 필요하다. 목표 120화.')});
 await page.getByRole('button',{name:'기획 초안 만들기',exact:true}).click();await expect(page.getByRole('heading',{name:projectName,exact:true})).toBeVisible();
 await page.getByRole('button',{name:'원문 분석 · 질문 만들기'}).click();await consent(page);
 const answers=page.locator('.questions textarea');await expect(answers).toHaveCount(6);
 for(let i=0;i<6;i++)await answers.nth(i).fill('사용자가 직접 확정한 목표와 경계를 유지합니다.');
 await page.getByRole('button',{name:'답변 저장',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'인터뷰 답변을 서버에 저장했습니다.'})).toBeVisible();
 await page.getByRole('button',{name:/STEP 02/}).click();
 await page.getByLabel('작품 문체 선택').selectOption({label:styleName+' · v1'});
 await page.getByRole('button',{name:'모듈 생성',exact:true}).click();await consent(page);
 await expect(page.getByRole('textbox',{name:'상세 기획',exact:true})).toHaveValue(/개발용 기획/);
 await page.getByRole('textbox',{name:'상세 기획',exact:true}).fill('사용자가 직접 편집한 기획입니다. 기록관은 약속을 지키기 위해 손해를 감수합니다. 그 선택의 결과가 인물의 다음 목표와 관계 변화를 촉발합니다.');
 await page.getByRole('button',{name:'이 모듈 저장'}).click();
 await expect(page.getByRole('status').filter({hasText:'모듈을 저장했습니다.'})).toBeVisible();
 await page.reload();await expect(page.getByRole('heading',{name:'이야기를 이어갈 시간이에요.'})).toBeVisible();
 await page.getByRole('button',{name:new RegExp(projectName)}).first().click();
 await page.getByRole('button',{name:/STEP 02/}).click();
 await expect(page.getByRole('textbox',{name:'상세 기획',exact:true})).toHaveValue(/사용자가 직접 편집한 기획/);
 await expect(page.getByRole('button',{name:'기획 승인 · 작품 등록'})).toBeDisabled();
});
test('dashboard fits a narrow screen and logout clears session',async({page})=>{
 await page.setViewportSize({width:390,height:844});await login(page);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
 await page.getByRole('button',{name:'메뉴',exact:true}).click();
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'로그아웃',exact:true}).click();
 await expect(page.getByRole('button',{name:'Google 계정으로 시작하기'})).toBeVisible();
 expect(await page.evaluate(()=>localStorage.length)).toBe(0);
});

test('writing editor autosaves, detects a competing revision, restores a snapshot and approves a reviewed chapter',async({page,request})=>{
 test.setTimeout(180000);
 const email='writing-flow@novelforge.test';
 await page.route('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:*',async route=>{
  const body=route.request().postDataJSON();
  if(body?.email)body.email=email;
  await route.continue({postData:JSON.stringify(body)});
 });
 await login(page);
 const signIn=await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{data:{email,password:'local-emulator-only',returnSecureToken:true}});
 expect(signIn.ok()).toBeTruthy();const token=(await signIn.json()).idToken;
 const headers={Authorization:'Bearer '+token};
 async function call(path:string,data?:unknown,method='POST'){
  const res=await request.fetch('/api'+path,{method,headers,data});expect(res.ok(),await res.text()).toBeTruthy();return res.json();
 }
 const ai=(p:any)=>({revision:p.revision,consent:true,maxCostUsd:.15});
 let s=await call('/styles',{name:'집필실 문체',sourceType:'interview',notes:'가까운 3인칭으로 자연스러운 한국어를 사용합니다. 감정의 원인을 행동에 연결하고 대사는 짧고 담백하게, 변화 뒤에는 여운을 둡니다.'});
 s=await call('/styles/'+s.id+'/analyze',ai(s));s=await call('/styles/'+s.id+'/approve',{revision:s.revision,confirmed:true,variant:'A'});
 const created=await request.post('/api/projects',{headers,multipart:{title:'집필실 저장 검증',genre:'현대 판타지',file:{name:'idea.txt',mimeType:'text/plain',buffer:Buffer.from('성인 기록관이 잃어버린 약속을 찾는다.\n주인공의 선택에는 대가와 결과가 따른다. 목표 120화.')}}});
 expect(created.ok()).toBeTruthy();let p=await created.json();const base='/projects/'+p.id;
 p=await call(base+'/analyze',ai(p));p=await call(base+'/answers',{revision:p.revision,answers:Object.fromEntries(p.analysis.questions.map((q:any)=>[q.id,'사용자가 목표와 경계를 직접 결정합니다.']))},'PUT');
 const keys=['concept','protagonist','characters','relationships','world','narrative','fun','density','style','special','serial'];
 for(let i=0;i<keys.length;i++){
  // Exercise the real per-minute limit without weakening it for tests.
  // First 9 sections + analysis + style = 11 requests. Wait for the next UTC minute.
  if(i===9)await new Promise(resolve=>setTimeout(resolve,61000-Date.now()%60000));
  p=await call(base+'/sections/'+keys[i]+'/generate',ai(p));
 }
 p=await call(base+'/style',{revision:p.revision,styleId:s.id});p=await call(base+'/bible/review',ai(p));p=await call(base+'/approve',{revision:p.revision,confirmed:true});
 p=await call(base+'/plot/generate',ai(p));p=await call(base+'/plot/approve',{revision:p.revision,confirmed:true});
 await page.reload();await expect(page.getByRole('heading',{name:'이야기를 이어갈 시간이에요.'})).toBeVisible();
 await page.getByRole('button',{name:/집필실 저장 검증/}).first().click();await page.getByRole('button',{name:/STEP 04/}).click();
 await page.getByRole('button',{name:'첫 장면 집필하기'}).click();await consent(page);
 await expect(page.getByRole('textbox',{name:'원고 편집기'})).toContainText('문 앞에서 걸음을 멈췄다.');
 await page.getByRole('button',{name:'다음 장면 집필',exact:true}).click();await consent(page);
 await expect(page.getByRole('button',{name:'다음 장면 집필',exact:true})).toHaveCount(0);
 const editor=page.getByRole('textbox',{name:'원고 편집기'});
 await editor.fill('기록관은 문 앞에서 약속을 떠올렸다. 😀\n다음 선택에는 대가가 따른다.');
 await expect(page.locator('.save-indicator')).toHaveText('서버에 저장 완료');
 let ch=await call(base+'/chapter',undefined,'GET');expect(ch.content).toContain('기록관은 문 앞에서');
 await page.getByRole('button',{name:'현재 버전 기록'}).click();await expect(page.getByRole('status').filter({hasText:'불변 원고 스냅샷'})).toBeVisible();
 // A second client saves between this editor's changes and its debounce.
 await editor.fill('내 창에서 이어 쓴 문장. 병합할 내용을 잃지 않아야 한다.');
 ch=await call(base+'/chapter',{revision:ch.revision,title:ch.title,content:'다른 창에서 먼저 저장한 문장.'},'PUT');
 const collision=page.getByRole('dialog',{name:'동시 편집 충돌 감지'});await expect(collision).toBeVisible();
 await expect(collision.getByRole('textbox')).toHaveValue('내 창에서 이어 쓴 문장. 병합할 내용을 잃지 않아야 한다.');
 await collision.getByRole('textbox').fill('다른 창의 문장과 내 문장을 직접 검수해 병합했다.');
 await collision.getByRole('button',{name:'병합한 내용 저장'}).click();await expect(collision).not.toBeVisible();
 await expect(editor).toContainText('직접 검수해 병합했다.');
 await page.getByRole('button',{name:'이전 버전 · 복구'}).click();const history=page.getByRole('dialog',{name:'원고 버전 이력'});
 await history.locator('.version-list button').first().click();await history.getByRole('button',{name:'선택 버전 복원'}).click();await expect(history).not.toBeVisible();
 await expect(editor).toContainText('기록관은 문 앞에서 약속을 떠올렸다.');
 await page.getByRole('button',{name:'독립 검토',exact:true}).click();await consent(page);
 await expect(page.locator('.review-panel')).toContainText('개발용 검토');
 await page.getByRole('checkbox',{name:/원고와 검토 근거를 직접 확인/}).check();await page.getByRole('button',{name:'회차 확정',exact:true}).click();
 await expect(page.locator('.manuscript-heading')).toContainText('승인 완료');
 await expect(editor).toHaveAttribute('contenteditable','false');
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:'/workspace/novelforge-runtime/writing-room.png',fullPage:true});
});
