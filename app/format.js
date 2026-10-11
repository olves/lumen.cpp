'use strict';
// Message formatting with local libraries (vendor/): markdown-it (raw HTML off, link schemes validated), highlight.js for code
// and KaTeX for math (trust off, DOM rendering under the strict CSP). Model output is never treated as HTML. Code highlighting
// and math run when a block scrolls into view, so opening long chats does not block the UI. Copy buttons copy the source text.
Object.assign(translations,{copyCode:['Copy','Kopyala'],copiedCode:['Copied','Kopyalandı'],codePlain:['code','kod'],imageLink:['image: {alt}','görsel: {alt}']});
const mdParser=window.markdownit({html:false,linkify:true,breaks:false,typographer:false});
mdParser.validateLink=url=>/^(https?:|mailto:)/i.test(String(url).trim());
mdParser.linkify.set({fuzzyLink:false,fuzzyEmail:false});

// ---------- Math ----------
// Inline: $…$ (no space inside the delimiters, closing $ not followed by a digit, so "$5 and $10" stays text) and \(…\).
function mathInline(state,silent){
 const src=state.src,pos=state.pos,ch=src[pos];
 if(ch==='\\'&&src[pos+1]==='('){const end=src.indexOf('\\)',pos+2);if(end<0)return false;if(!silent){const token=state.push('math_inline','',0);token.content=src.slice(pos+2,end);}state.pos=end+2;return true;}
 if(ch!=='$'||src[pos+1]==='$')return false;
 const next=src[pos+1];if(!next||/\s/.test(next))return false;
 let end=pos+1;
 while((end=src.indexOf('$',end))!==-1){if(src[end-1]==='\\'){end++;continue;}if(/\s/.test(src[end-1])||/\d/.test(src[end+1]||'')){end++;continue;}break;}
 if(end===-1||end===pos+1)return false;const content=src.slice(pos+1,end);if(content.includes('\n\n'))return false;
 if(!silent){const token=state.push('math_inline','',0);token.content=content;}state.pos=end+1;return true;
}
// Block: $$…$$ or \[…\] starting a line, on one line or several.
function mathBlock(state,start,end,silent){
 const first=state.bMarks[start]+state.tShift[start],line=state.src.slice(first,state.eMarks[start]);
 const open=line.startsWith('$$')?'$$':line.startsWith('\\[')?'\\[':null;if(!open)return false;const close=open==='$$'?'$$':'\\]';
 let body=line.slice(2),current=start,found=false;
 if(body.trimEnd().endsWith(close)&&body.trim().length>=close.length){body=body.trimEnd().slice(0,-close.length);found=true;}
 while(!found&&++current<end){const text=state.src.slice(state.bMarks[current]+state.tShift[current],state.eMarks[current]);if(text.trimEnd().endsWith(close)){body+='\n'+text.trimEnd().slice(0,-close.length);found=true;break;}body+='\n'+text;}
 if(!found)return false;if(silent)return true;
 const token=state.push('math_block','',0);token.block=true;token.content=body.trim();token.map=[start,current+1];state.line=current+1;return true;
}
mdParser.inline.ruler.before('escape','math_inline',mathInline);
mdParser.block.ruler.before('fence','math_block',mathBlock,{alt:['paragraph','reference','blockquote','list']});
const escapeHtml=mdParser.utils.escapeHtml;
mdParser.renderer.rules.math_inline=(tokens,i)=>`<span class="math pending-render" data-tex="${escapeHtml(tokens[i].content)}">${escapeHtml(tokens[i].content)}</span>`;
mdParser.renderer.rules.math_block=(tokens,i)=>`<div class="math math-display pending-render" data-tex="${escapeHtml(tokens[i].content)}">${escapeHtml(tokens[i].content)}</div>`;

// ---------- Code, tables, images, links ----------
mdParser.renderer.rules.fence=(tokens,i,options,env)=>{
 const token=tokens[i],info=(token.info||'').trim().split(/\s+/)[0].toLowerCase(),code=token.content.replace(/\n$/,'');
 const known=info&&hljs.getLanguage(info)?info:'';const index=env.codes.push(code)-1;
 return `<div class="code-block"><div class="code-heading"><span class="code-lang">${escapeHtml(info||t('codePlain'))}</span><button type="button" class="code-copy" data-code="${index}">${escapeHtml(t('copyCode'))}</button></div><pre><code class="hljs${known?' pending-render':''}"${known?` data-lang="${escapeHtml(known)}"`:''}>${escapeHtml(code)}</code></pre></div>`;
};
mdParser.renderer.rules.code_block=(tokens,i,options,env)=>{const code=tokens[i].content.replace(/\n$/,'');const index=env.codes.push(code)-1;return `<div class="code-block"><div class="code-heading"><span class="code-lang">${escapeHtml(t('codePlain'))}</span><button type="button" class="code-copy" data-code="${index}">${escapeHtml(t('copyCode'))}</button></div><pre><code class="hljs">${escapeHtml(code)}</code></pre></div>`;};
// Column alignment arrives as a style attribute, which the CSP blocks; it becomes a class instead.
mdParser.core.ruler.push('align_classes',state=>{for(const token of state.tokens){if(token.type!=='inline'&&!/^t[hd]_open$/.test(token.type))continue;const style=token.attrGet&&token.attrGet('style');if(!style)continue;const align=/text-align:\s*(left|right|center)/.exec(style);token.attrs=token.attrs.filter(([name])=>name!=='style');if(align)token.attrJoin('class','align-'+align[1]);}});
mdParser.renderer.rules.table_open=()=>'<div class="table-scroll"><table>';
mdParser.renderer.rules.table_close=()=>'</table></div>';
// Remote images are never loaded (privacy, CSP); they appear as a link with their description.
mdParser.renderer.rules.image=(tokens,i)=>{const token=tokens[i],src=token.attrGet('src')||'',alt=token.content||src;return /^https?:/i.test(src)?`<a href="${escapeHtml(src)}" class="image-link">${escapeHtml(tf('imageLink',{alt}))}</a>`:escapeHtml(alt);};

// ---------- Rendering ----------
const renderObserver=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;renderObserver.unobserve(entry.target);renderPending(entry.target);}},{root:null,rootMargin:'400px 0px'});
const highlightLimit=150000;
function renderPending(node){
 node.classList.remove('pending-render');
 if(node.dataset.tex!==undefined){try{katex.render(node.dataset.tex,node,{displayMode:node.classList.contains('math-display'),throwOnError:false,trust:false,strict:'ignore',maxExpand:500,maxSize:20});}catch{node.textContent=node.dataset.tex;}return;}
 const lang=node.dataset.lang,text=node.textContent;if(!lang||text.length>highlightLimit)return;
 try{node.innerHTML=hljs.highlight(text,{language:lang,ignoreIllegals:true}).value;}catch{}
}
markdown=function(body,text){
 diagnostics.markdownRenders++;const env={codes:[]};
 body.innerHTML=mdParser.render(String(text||''),env);body.classList.add('md');
 body.querySelectorAll('.code-copy').forEach(button=>{const code=env.codes[Number(button.dataset.code)]??'';button.onclick=()=>{copyText(code);button.textContent=t('copiedCode');setTimeout(()=>{button.textContent=t('copyCode');},1200);};});
 body.querySelectorAll('a[href]').forEach(link=>{const href=link.getAttribute('href');link.removeAttribute('target');link.onclick=event=>{event.preventDefault();if(/^https?:/i.test(href))openSource(href);};link.title=href;});
 // Highlighting and math wait until the block is near the viewport; until then the source text is shown.
 body.querySelectorAll('.pending-render').forEach(node=>renderObserver.observe(node));
};
