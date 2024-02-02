console.info('             [**]');
console.info('             [**]');
console.info('              [**]');
console.info('             [**]');
console.info('[**]          [**]');
console.info('    [*********]       [**]          What\'s good? Check more: https://github.com/Jacke');

// Function to render the menu
const renderMenu = () => {
  // Store the menu element in a variable for easier access
  const menu = document.getElementById("menu");

  // If the menu element exists
  if (menu) {
    // Set the scroll position of the menu to the last stored position in localStorage
    menu.scrollLeft = localStorage.getItem("menu-scroll-position");

    // Add an event listener to the menu's scroll event
    // When the menu scrolls, the new scroll position is stored in localStorage
    menu.onscroll = function () {
      localStorage.setItem("menu-scroll-position", menu.scrollLeft);
    };
  }

  // Query all anchor tags in the document that have href attributes starting with '#'
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    // Add a click event listener to each anchor
    anchor.addEventListener("click", function (e) {
      // Prevent the default anchor click behavior
      e.preventDefault();

      // Get the id from the href attribute of the clicked anchor (excluding the '#' at the beginning)
      const id = this.getAttribute("href").substr(1);

      // Decode the id in case it contains any URL-encoded characters
      const decodedId = decodeURIComponent(id);

      // Get the element with the decoded id
      const targetElement = document.querySelector(`[id='${decodedId}']`);

      // If the user has not set their preference for reduced motion or if they have and it is set to 'no-preference'
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        // Smoothly scroll the target element into view
        targetElement.scrollIntoView({ behavior: "smooth" });
      } else {
        // Otherwise, instantly scroll the target element into view without a smooth scrolling animation
        targetElement.scrollIntoView();
      }

      // If the id is 'top'
      if (id === "top") {
        // Replace the current history state with a new state that has no URL fragment
        history.replaceState(null, null, " ");
      } else {
        // Otherwise, push a new history state with the URL fragment set to the id
        history.pushState(null, null, `#${id}`);
      }
    });
  });
};

const addScroller = () => {
  var mybutton = document.getElementById("top-link");
  window.onscroll = function () {
    if (
      document.body.scrollTop > 800 ||
      document.documentElement.scrollTop > 800
    ) {
      mybutton.style.visibility = "visible";
      mybutton.style.opacity = "1";
    } else {
      mybutton.style.visibility = "hidden";
      mybutton.style.opacity = "0";
    }
  };

  const getTimestampInSeconds = () => {
    return Math.floor(Date.now() / 1000);
  };
  const highlightState = localStorage.getItem("highlight");
  const parsedInt = parseInt(highlightState);
  const needHighlight = ((highlightState !== undefined) && (parsedInt !== undefined))
    ? (getTimestampInSeconds() - parsedInt) > 1440
    : true;
  console.log('parsedInt, needHighlight', parsedInt, needHighlight);

  if (needHighlight) {
    localStorage.setItem("highlight", getTimestampInSeconds());
    primaryAnimation();
  } else {
    var elems = document.querySelectorAll(".to-out");
    [].forEach.call(elems, function (el) {
      el.classList.remove("to-out");
    });
  }
};

const addThemeToggler = () => {
  document.getElementById("theme-toggle").addEventListener("click", () => {
    isDark = document.body.className.includes("dark");
    if (isDark) {
      document.body.classList.remove("dark");
      localStorage.setItem("pref-theme", "light");
      document.getElementsByTagName("meta")["theme-color"].content = "#f5f5f5";
    } else {
      document.body.classList.add("dark");
      localStorage.setItem("pref-theme", "dark");
      document.getElementsByTagName("meta")["theme-color"].content = "#1d1e20";
    }
    isDark = document.body.className.includes("dark");
    try {
      // Light
      document.querySelector("#code-demo canvas").remove();
      setTimeout(() => {
        document.querySelector("#code-demo .blurr").classList.add("active");
        init();
        mouseCoords = new THREE.Vector2(presetCoords[0].x, presetCoords[0].y);
        need_update = true;
        animate();
        document.querySelector("#code-demo .blurr").classList.remove("active");
      }, 300);
    } catch (e) {
      console.error(e);
    }
  });
};

const addCodeRenderer = () => {
  document.querySelectorAll("pre > code").forEach((codeblock) => {
    const container = codeblock.parentNode.parentNode;

    const copybutton = document.createElement("button");
    copybutton.classList.add("copy-code");
    copybutton.innerHTML = '{{- i18n "code_copy" | default "copy" }}';

    function copyingDone() {
      copybutton.innerHTML = '{{- i18n "code_copied" | default "copied!" }}';
      setTimeout(() => {
        copybutton.innerHTML = '{{- i18n "code_copy" | default "copy" }}';
      }, 2000);
    }

    copybutton.addEventListener("click", (cb) => {
      if ("clipboard" in navigator) {
        navigator.clipboard.writeText(codeblock.textContent);
        copyingDone();
        return;
      }

      const range = document.createRange();
      range.selectNodeContents(codeblock);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      try {
        document.execCommand("copy");
        copyingDone();
      } catch (e) {}
      selection.removeRange(range);
    });

    if (container.classList.contains("highlight")) {
      container.appendChild(copybutton);
    } else if (container.parentNode.firstChild == container) {
      // td containing LineNos
    } else if (
      codeblock.parentNode.parentNode.parentNode.parentNode.parentNode
        .nodeName == "TABLE"
    ) {
      // table containing LineNos and code
      codeblock.parentNode.parentNode.parentNode.parentNode.parentNode.appendChild(
        copybutton
      );
    } else {
      // code blocks not having highlight as parent class
      codeblock.parentNode.appendChild(copybutton);
    }
  });
};

const addGoogleTag = () => {
  window.dataLayer = window.dataLayer || [];
  function gtag() {
    dataLayer.push(arguments);
  }
  gtag("js", new Date());
  gtag("config", "{{ . }}");
};

const primaryAnimation = () => {
  var loopCompleted = 0;
  anime
    .timeline({
      loop: true,
      duration: 6000,
      loopComplete: function (anim) {
        loopCompleted++;
        if (loopCompleted > 3) {
          anime.remove(".text-box .ani-text2 color");
        }
      },
    })
    .add({
      targets: ".text-box .ani-text2 color",
      color: randomAct.color,
      easing: "easeInOutSine",
      duration: 1000,
    })
    .add({
      targets: ".text-box .ani-text2 color",
      color: randomAct.colorEnd,
      easing: "easeInOutSine",
      duration: 1000,
    });

  anime
    .timeline({ loop: false })
    .add({
      targets: ".to-out",
      opacity: 0,
      duration: 1000,
      easing: "easeOutExpo",
      delay: 1000,
    })
    .add({
      targets: ".text-box .ani-text",
      translateY: [100, 0],
      easing: "easeOutExpo",
      duration: 1400,
    })
    .add({
      targets: ".text-box .ani-text",
      opacity: 0,
      easing: "easeOutExpo",
      duration: 400,
      delay: 1000,
    })
    .add({
      targets: ".text-box .ani-text2",
      translateY: [100, 0],
      easing: "easeOutExpo",
      duration: 1400,
    })
    .add({
      targets: ".text-box",
      display: "none",
      width: "0px",
      height: "0px",
      duration: 1000,
      easing: "easeOutExpo",
      delay: 1000,
    })
    .add({
      targets: ".to-out",
      opacity: 1,
      duration: 1000,
      easing: "easeOutExpo",
    });
};

const runRandomAct = () => {
  const actTextEl = document.getElementById('act-text');
  const someAct = data[Math.floor(Math.random()*data.length)];
  const defaultAct = {
    name: 'Create',
    color: '#9630a7',
    color_end: '#9630a7',
  };
  var randomAct = someAct ? someAct : defaultAct;
  actTextEl.textContent = randomAct.name;
  actTextEl.style.color = randomAct.color;
  var elems = document.querySelectorAll(".themable-button");
  [].forEach.call(elems, function (el) {
    el.style.background = randomAct.color;
  });
};