const purgecss = require('@fullhuman/postcss-purgecss');

module.exports = {
  plugins: [
    require('tailwindcss'),
    require('autoprefixer'),
    // Only run PurgeCSS in production
    process.env.NODE_ENV === 'production'
      ? purgecss({
          content: [
            './pages/**/*.html', 
            './js/**/*.js'
          ],
          safelist: {
            standard: [
              'fas', 'far', 'fab', 'fa', // Base Font Awesome classes
              /^fa-/                      // Keep any class starting with fa-
            ],
            deep: [/^fa-/], // Ensures pseudo-elements like :before are kept
          },
          defaultExtractor: (content) => content.match(/[\w-/:]+(?<!:)/g) || [],
        })
      : null,
  ],
};
