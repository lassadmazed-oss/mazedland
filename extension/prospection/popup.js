// The popup: read the post of the current Facebook tab, let the member check it, open Mazed with the form filled.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var hint = $("hint");

  function say(text, warn) {
    hint.textContent = text;
    hint.className = warn ? "hint warn" : "hint";
  }

  function isFacebook(url) {
    try {
      return /(^|\.)facebook\.com$/.test(new URL(url).hostname);
    } catch (e) {
      return false;
    }
  }

  chrome.storage.local.get({ lang: "ar" }, function (saved) {
    $("lang").value = saved.lang === "fr" ? "fr" : "ar";
  });
  $("lang").addEventListener("change", function () {
    chrome.storage.local.set({ lang: $("lang").value });
  });

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var tab = tabs && tabs[0];
    if (!tab || !tab.id || !isFacebook(tab.url || "")) {
      say("حلّ بوست في فيسبوك وبعدها اضغط على الإضافة. تنجم زادة تلصق النص بيدك هنا.", true);
      return;
    }
    // The extractor is put into the tab, then asked: the page is read only now, because the member clicked.
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["extract.js"] }, function () {
      if (chrome.runtime.lastError) {
        say("ما نجّمتش نقرا الصفحة. حدّد نص البوست بالفأرة وعاود اضغط على الإضافة.", true);
        return;
      }
      chrome.scripting.executeScript({ target: { tabId: tab.id }, func: function () { return self.__mazedExtract(); } }, function (res) {
        var post = res && res[0] && res[0].result;
        if (!post) {
          say("ما لقيناش البوست. حدّد نصو بالفأرة وعاود.", true);
          return;
        }
        $("text").value = post.text || "";
        $("url").value = post.url || "";
        $("name").value = post.name || "";
        if (post.source === "selection") say("لقينا النص اللي حدّدتو. راجعو وابعثو.");
        else if (post.source === "article") say("خدمنا النص من البوست الظاهر في الشاشة. راجعو قبل ما تبعثو، وكان فيه غلط حدّد النص بالفأرة وعاود.", false);
        else say("ما لقيناش نص البوست. حدّدو بالفأرة وعاود اضغط على الإضافة.", true);
      });
    });
  });

  $("send").addEventListener("click", function () {
    var text = $("text").value.trim();
    if (text.length < 20) {
      say("النص قصير برشا. الصق نص البوست كامل.", true);
      return;
    }
    // The payload travels in the URL's fragment: it is never sent to a server, only read by the page that opens.
    var payload = self.__mazedEncode({ text: text, url: $("url").value.trim(), name: $("name").value.trim() });
    var lang = $("lang").value === "fr" ? "fr" : "ar";
    chrome.tabs.create({ url: MAZED_ORIGIN + "/" + lang + "/admin/prospection/nouveau#import=" + payload });
  });
})();
