import {test} from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {extract,overlap} from '../../worker/parsers';
test('DOCX and EPUB extract text without executing document content',async()=>{
 const docx=zipSync({'word/document.xml':strToU8('<w:document><w:body><w:p><w:r><w:t>안전한 원문</w:t></w:r></w:p></w:body></w:document>')});assert.equal((await extract('sample.docx',docx)).text,'안전한 원문');
 const epub=zipSync({'META-INF/container.xml':strToU8('<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>'),'book.opf':strToU8('<package><manifest><item id="one" href="a.xhtml"/><item id="two" href="b.xhtml"/></manifest><spine><itemref idref="two"/><itemref idref="one"/></spine></package>'),'a.xhtml':strToU8('<html><body>첫 번째</body></html>'),'b.xhtml':strToU8('<html><body>두 번째</body></html>')});assert.equal((await extract('sample.epub',epub)).text,'두 번째\n첫 번째');
});
test('parsers reject empty/binary, active content, DRM and entity declarations',async()=>{
 await assert.rejects(extract('empty.txt',new Uint8Array()));await assert.rejects(extract('binary.txt',new Uint8Array([65,0,66])));
 await assert.rejects(extract('active.docx',zipSync({'word/vbaProject.bin':new Uint8Array([1])})));
 await assert.rejects(extract('drm.epub',zipSync({'META-INF/encryption.xml':strToU8('<encryption/>')})));
 await assert.rejects(extract('entity.docx',zipSync({'word/document.xml':strToU8('<!DOCTYPE foo><w:document/>')})));
 assert.equal(overlap('가'.repeat(40),'가'.repeat(32)),true);
});
