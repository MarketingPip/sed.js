const purgecss = require('@fullhuman/postcss-purgecss');

module.exports = {
  plugins: [
    purgecss({
      // 1. Tell it where your HTML files are
      content: ['./pages/**/*.html', './js/**/*.js'],
      
      // 2. The "Normal" safelist for Font Awesome
      safelist: [
        'fas', 'far', 'fab', 'fa', // The base classes
        /^fa-/                     // Any class starting with fa-
      ]
    })
  ]
};
