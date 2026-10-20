// Footer heart: click fills it and sends up a burst of flying hearts (same as the other CodeLove sites).
document.querySelectorAll('.heart-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    btn.classList.add('on');
    for (let i = 0; i < 12; i++) {
      const h = document.createElement('span');
      h.className = 'fly-heart';
      h.textContent = '❤️';
      h.style.fontSize = (Math.random() * 10 + 8) + 'px';
      h.style.animationDuration = (Math.random() * 0.8 + 0.8) + 's';
      h.style.setProperty('--tx', (Math.random() - 0.5) * 100 + 'px');
      h.style.setProperty('--ty', (Math.random() - 0.5) * 100 - 40 + 'px');
      h.style.setProperty('--r', (Math.random() - 0.5) * 90 + 'deg');
      btn.parentNode.appendChild(h);
      setTimeout(() => h.remove(), 1600);
    }
  });
});
