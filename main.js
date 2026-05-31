// 스크롤 진입 시 섹션을 부드럽게 등장시킨다.
const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (e.isIntersecting) {
      e.target.style.animation = 'rise .8s cubic-bezier(.2,.7,.2,1) forwards';
      io.unobserve(e.target);
    }
  });
}, { threshold: 0.12 });

document.querySelectorAll('section, .project').forEach((el) => {
  el.style.opacity = '0';
  io.observe(el);
});
