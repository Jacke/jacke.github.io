const getOffset = (el, title) => {
  var _x = 0;
  var _y = 0;
  while (el && !isNaN(el.offsetLeft) && !isNaN(el.offsetTop)) {
    _x += el.offsetLeft - el.scrollLeft;
    _y += el.offsetTop - el.scrollTop;
    el = el.offsetParent;
  }
  return { el: title, top: _y, left: _x };
};
const getYPosition = () => {
  var top = window.pageYOffset || document.documentElement.scrollTop;
  return top;
};
const renderNav = () => {
  const navs = [...document.getElementsByTagName("a")];
  const pos = document.documentElement.scrollTop || document.body.scrollTop;
  const sections = document.getElementsByTagName("section");
  var positions = [];
  for (var element of sections) {
    positions = positions.concat([getOffset(element, element)]);
  }

  const elems = positions.filter((el) => el.top >= pos - 1);
  const passedElems = positions.filter((el) => el.top <= pos + 1);
  var elem;
  if (passedElems.length > 0) {
    elem = passedElems.reverse()[0];
  } else {
    elem = elems[0];
  }
  navs.forEach((elem) => {
    elem.style.color = "#0645ad";
  });
  const nav_elem = navs.find(
    (el) => el.attributes.href.value.replace("#", "") == elem.el.id
  );
  if (nav_elem) {
    nav_elem.style.color = "#e91e63";
  }
};
const toggleNavbar = () => {
  const navBar = document.getElementById("navbar");
  navBar.classList.toggle("active");
};

const addResourceSelector = () => {
  var checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.name = "chkbox1";
  checkbox.id = "resource-checkbox";
  var label = document.createElement("label");
  var tn = document.createTextNode("Resources");
  label.htmlFor = "cbid";
  label.appendChild(tn);
  const navBar = document.getElementById("navbar");
  navBar.appendChild(label);
  navBar.appendChild(checkbox);

  console.log('checkbox', checkbox, checkbox.onchange);
  checkbox.addEventListener('change', (event) => {
    toggleResources();
  }, false);
  return checkbox;
};

const toggleResources = () => {
  const resourcesElems = document.getElementsByClassName("resources");
  [...resourcesElems].forEach((el) => el.classList.toggle("active"));
};

window.addEventListener("load", (event) => {
  const titleHeader = document.getElementById("title-block-header");
  titleHeader.onclick = () => toggleNavbar();
  [...document.querySelectorAll("ul#navbar a")].forEach(
    (el) => (el.onclick = () => toggleNavbar())
  );
  window.onscroll = () => renderNav();
  renderNav();
  addResourceSelector();
});
