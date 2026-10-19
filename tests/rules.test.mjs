// Real Firestore + Storage emulator security tests, never substituted with memory adapters.
import {readFile} from 'node:fs/promises';
import {before,after,test} from 'node:test';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,updateDoc} from 'firebase/firestore';
import {ref,uploadBytes,getBytes} from 'firebase/storage';
let env;
before(async()=>{
 env=await initializeTestEnvironment({projectId:'demo-novelforge',firestore:{host:'127.0.0.1',port:8080,rules:await readFile('firestore.rules','utf8')},storage:{host:'127.0.0.1',port:9199,rules:await readFile('storage.rules','utf8')}});
 await env.withSecurityRulesDisabled(async ctx=>{
  await setDoc(doc(ctx.firestore(),'users/alice/projects/security-fixture'),{ownerUid:'alice',status:'ACTIVE'});
  await setDoc(doc(ctx.firestore(),'users/alice/projects/security-fixture/chapters/chapter-1'),{ownerUid:'alice',content:'비공개 원고',revision:1,status:'APPROVED'});
  await setDoc(doc(ctx.firestore(),'users/alice/projects/security-fixture/approval_records/v1'),{ownerUid:'alice',canonVersion:1});
  await uploadBytes(ref(ctx.storage(),'users/alice/projects/security-fixture/source-briefs/test.txt'),new TextEncoder().encode('비공개 자료'));
 });
});
after(async()=>{if(env)await env.cleanup();});
test('owner can read own content; other UID and anonymous cannot',async()=>{
 const path='users/alice/projects/security-fixture/chapters/chapter-1';
 await assertSucceeds(getDoc(doc(env.authenticatedContext('alice').firestore(),path)));
 await assertFails(getDoc(doc(env.authenticatedContext('bob').firestore(),path)));
 await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),path)));
});
test('even the owner cannot bypass approval, canon or revision using direct SDK writes',async()=>{
 const db=env.authenticatedContext('alice').firestore();
 await assertFails(updateDoc(doc(db,'users/alice/projects/security-fixture'),{status:'ACTIVE',canonVersion:999}));
 await assertFails(updateDoc(doc(db,'users/alice/projects/security-fixture/chapters/chapter-1'),{content:'무단 변경',revision:0}));
 await assertFails(setDoc(doc(db,'users/alice/projects/security-fixture/approval_records/v2'),{canonVersion:2}));
 await assertFails(setDoc(doc(db,'users/alice/usage/fake'),{actualUsd:0}));
 await assertFails(setDoc(doc(db,'users/alice/jobs/fake'),{status:'COMPLETED'}));
});
test('unknown top-level content collections and cross-user writes are denied',async()=>{
 const db=env.authenticatedContext('alice').firestore();
 await assertFails(setDoc(doc(db,'projects/unscoped'),{ownerUid:'alice'}));
 await assertFails(setDoc(doc(db,'users/bob/style_profiles/fake'),{ownerUid:'bob'}));
});
test('Storage ownership isolation and immutable browser writes',async()=>{
 const path='users/alice/projects/security-fixture/source-briefs/test.txt';
 await assertSucceeds(getBytes(ref(env.authenticatedContext('alice').storage(),path)));
 await assertFails(getBytes(ref(env.authenticatedContext('bob').storage(),path)));
 await assertFails(getBytes(ref(env.unauthenticatedContext().storage(),path)));
 await assertFails(uploadBytes(ref(env.authenticatedContext('alice').storage(),path),new Uint8Array([1])));
});
