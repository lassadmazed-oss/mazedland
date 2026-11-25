/**
 * Keeps React standing when something outside the site rewrites the page
 * (2026-11-25). The error log showed one Android phone (Chrome 157), on 21, 22
 * and 25 November, hit the same pair on annonce pages and the login page:
 * React #418 (the page's text no longer what the server sent) then
 * « Failed to execute 'insertBefore' / 'removeChild' on 'Node': … not a child
 * of this node » — and the visitor got the error page. That pair is the mark
 * of the browser's automatic translation (or an extension): it replaces the
 * text React wrote with its own <font> elements, and React, holding the old
 * nodes, inserts before or removes a node that is no longer where it left it
 * (facebook/react#11538).
 *
 * The guard makes those two calls forgiving, only in that situation: a node
 * to remove that has moved is removed from where it is now (or left alone if
 * it is gone), and a node to insert before a reference that has moved is
 * added at the end of the parent. The page may keep a translated word a moment
 * too long; it no longer falls over. Everything else goes through untouched.
 *
 * Runs as an inline script at the top of <head> (src/app/[locale]/layout.tsx),
 * before React starts; the CSP allows inline scripts.
 */
export const DOM_GUARD_SCRIPT = `(function(){try{var N=typeof Node==="function"?Node:null;if(!N||!N.prototype||N.prototype.__mzDomGuard)return;var p=N.prototype,rm=p.removeChild,ib=p.insertBefore;p.removeChild=function(c){if(c&&c.parentNode!==this){if(c.parentNode)return rm.call(c.parentNode,c);return c}return rm.apply(this,arguments)};p.insertBefore=function(n,r){if(r&&r.parentNode!==this)return ib.call(this,n,null);return ib.apply(this,arguments)};p.__mzDomGuard=true}catch(e){}})();`;
