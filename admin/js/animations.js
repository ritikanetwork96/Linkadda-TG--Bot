// admin/js/animations.js

document.addEventListener('DOMContentLoaded', () => {
  // Initialize standard CSS for animations
  const style = document.createElement('style');
  style.textContent = `
    .animate-on-scroll {
      opacity: 0;
      transform: translateY(20px) scale(0.98);
      transition: opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1), transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
      will-change: opacity, transform;
    }
    
    .animate-on-scroll.is-visible {
      opacity: 1;
      transform: translateY(0) scale(1);
    }

    /* Stagger children in grids/lists */
    .stagger-container > * {
      opacity: 0;
      transform: translateY(15px);
      transition: opacity 0.5s ease-out, transform 0.5s ease-out;
    }
    .stagger-container.is-visible > * {
      opacity: 1;
      transform: translateY(0);
    }
    
    /* Auto-generate transition delays for staggered items */
    .stagger-container.is-visible > *:nth-child(1) { transition-delay: 50ms; }
    .stagger-container.is-visible > *:nth-child(2) { transition-delay: 100ms; }
    .stagger-container.is-visible > *:nth-child(3) { transition-delay: 150ms; }
    .stagger-container.is-visible > *:nth-child(4) { transition-delay: 200ms; }
    .stagger-container.is-visible > *:nth-child(5) { transition-delay: 250ms; }
    .stagger-container.is-visible > *:nth-child(6) { transition-delay: 300ms; }
    .stagger-container.is-visible > *:nth-child(7) { transition-delay: 350ms; }
    .stagger-container.is-visible > *:nth-child(8) { transition-delay: 400ms; }
    .stagger-container.is-visible > *:nth-child(n+9) { transition-delay: 450ms; }
  `;
  document.head.appendChild(style);

  // Intersection Observer to trigger animations
  const observerOptions = {
    root: null,
    rootMargin: '0px 0px -50px 0px',
    threshold: 0.1
  };

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        obs.unobserve(entry.target); // Run once
      }
    });
  }, observerOptions);

  // Function to apply classes to specific elements
  function initAnimations() {
    // Top level cards and section blocks
    const elementsToAnimate = document.querySelectorAll('.card:not(.animate-on-scroll), .metric-card:not(.animate-on-scroll), .section-block:not(.animate-on-scroll), .table-container:not(.animate-on-scroll)');
    elementsToAnimate.forEach(el => {
      el.classList.add('animate-on-scroll');
      observer.observe(el);
    });

    // Stagger containers like metrics grid
    const staggerContainers = document.querySelectorAll('.metrics-grid:not(.stagger-container), .row-split:not(.stagger-container)');
    staggerContainers.forEach(container => {
      container.classList.add('stagger-container');
      observer.observe(container);
    });
  }

  // Hook into our custom router (switchTab) to re-trigger animations
  window.addEventListener('load-dashboard', initAnimations);
  window.addEventListener('load-bots', initAnimations);
  window.addEventListener('load-content', initAnimations);
  window.addEventListener('load-content-packs', initAnimations);
  window.addEventListener('load-categories', initAnimations);
  window.addEventListener('load-links', initAnimations);
  window.addEventListener('load-users', initAnimations);
  window.addEventListener('load-broadcasts', initAnimations);
  window.addEventListener('load-settings', initAnimations);

  // Initial trigger
  setTimeout(initAnimations, 100);
});
