/*
 * Reads the Facebook post the member is looking at, when they ask for it.
 *
 * It runs in the page only when the member clicks the extension (activeTab):
 * nothing is read in the background and nothing is sent from here. What it
 * finds goes into the extension's popup, where the member checks it; the popup
 * then opens Mazed Immo's « Nouvelle annonce trouvée » page with the form
 * filled in.
 *
 * Facebook's markup changes often and its class names mean nothing, so this
 * leans on the few things that stay: a post is a role="article", its message
 * is a dir="auto" block, the poster's name is a heading link, and its date
 * links to its permalink. The text the member SELECTS always wins over a guess.
 */
(function (root) {
  var MIN_TEXT = 20;
  var MAX_TEXT = 8000;
  var KEEP_PARAMS = ["story_fbid", "id", "fbid", "set", "multi_permalinks"];

  function clean(s) {
    return String(s == null ? "" : s)
      .replace(/ /g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function insideArticle(el) {
    var p = el && el.parentElement;
    return !!(p && p.closest && p.closest('[role="article"]'));
  }

  /** The post nearest the middle of the window; a comment is an article inside the post, so only outermost ones count. */
  function pickArticle(doc, win) {
    var all = Array.prototype.slice.call(doc.querySelectorAll('[role="article"]'));
    var outer = all.filter(function (a) { return !insideArticle(a); });
    var mid = win.innerHeight / 2;
    var best = null;
    var bestScore = -1;
    outer.forEach(function (a) {
      var r = a.getBoundingClientRect();
      var visible = Math.max(0, Math.min(r.bottom, win.innerHeight) - Math.max(r.top, 0));
      var score = (r.top <= mid && r.bottom >= mid ? 1e6 : 0) + visible;
      if (score > bestScore) { best = a; bestScore = score; }
    });
    return best;
  }

  /** The post's own words: its message block, else the leaf text blocks that are not a comment's. */
  function articleText(article) {
    if (!article) return "";
    var message = article.querySelector('[data-ad-preview="message"], [data-ad-comet-preview="message"]');
    if (message && clean(message.innerText).length >= MIN_TEXT) return clean(message.innerText);
    var blocks = Array.prototype.slice.call(article.querySelectorAll('[dir="auto"]'))
      .filter(function (b) { return !insideArticle(b) || b.closest('[role="article"]') === article; })
      .map(function (b) { return clean(b.innerText); })
      .filter(function (t) { return t.length >= 15; });
    // A block that contains another one repeats it: keep the leaves, once each.
    var leaves = blocks.filter(function (t, i) {
      return !blocks.some(function (o, j) { return j !== i && o.length < t.length && t.indexOf(o) !== -1; }) && blocks.indexOf(t) === i;
    });
    return clean(leaves.join("\n"));
  }

  function articleName(article) {
    if (!article) return "";
    var selectors = ["h2 a", "h3 a", "h2", "h3", 'a[role="link"] strong', "strong"];
    for (var i = 0; i < selectors.length; i++) {
      var el = article.querySelector(selectors[i]);
      var t = el ? clean(el.textContent) : "";
      if (t && t.length <= 80) return t;
    }
    return "";
  }

  /** A permalink without the tracking Facebook adds to every link. */
  function tidyUrl(href, base) {
    try {
      var u = new URL(href, base);
      if (!/(^|\.)facebook\.com$/.test(u.hostname) && !/(^|\.)fb\.com$/.test(u.hostname)) return "";
      var out = new URL(u.origin + u.pathname);
      KEEP_PARAMS.forEach(function (k) { if (u.searchParams.has(k)) out.searchParams.set(k, u.searchParams.get(k)); });
      return out.toString();
    } catch (e) {
      return "";
    }
  }

  function articleUrl(article, loc) {
    var here = tidyUrl(loc.href, loc.href);
    if (/\/(posts|permalink)\/|story_fbid|\/permalink\.php/.test(here)) return here;
    if (article) {
      var link = article.querySelector('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"], a[href*="/permalink.php"]');
      if (link) {
        var t = tidyUrl(link.getAttribute("href"), loc.href);
        if (t) return t;
      }
    }
    return here;
  }

  function encodePayload(post) {
    var json = JSON.stringify({ v: 1, text: post.text || "", url: post.url || "", name: post.name || "" });
    var bytes = new TextEncoder().encode(json);
    var bin = "";
    bytes.forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function extractPost(doc, win, loc) {
    var selection = win.getSelection ? clean(String(win.getSelection())) : "";
    var anchor = null;
    if (selection.length >= MIN_TEXT && win.getSelection().anchorNode) {
      var node = win.getSelection().anchorNode;
      var el = node.nodeType === 1 ? node : node.parentElement;
      anchor = el && el.closest ? el.closest('[role="article"]') : null;
      while (anchor && insideArticle(anchor)) anchor = anchor.parentElement.closest('[role="article"]');
    }
    var article = anchor || pickArticle(doc, win);
    var text = selection.length >= MIN_TEXT ? selection : articleText(article);
    return {
      text: text.slice(0, MAX_TEXT),
      url: articleUrl(article, loc),
      name: articleName(article),
      source: selection.length >= MIN_TEXT ? "selection" : text ? "article" : "none",
    };
  }

  root.__mazedExtract = function () { return extractPost(document, window, location); };
  if (typeof module !== "undefined" && module.exports) module.exports = { extractPost: extractPost, encodePayload: encodePayload, tidyUrl: tidyUrl };
  root.__mazedEncode = encodePayload;
})(typeof self !== "undefined" ? self : globalThis);
