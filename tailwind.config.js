module.exports = {
  content: ['./layouts/*.html', './layouts/**/*.html', './content/**/*.md'],
  theme: {
    extend: {
        typography: {
            DEFAULT: {
                css: {
                    "code::before": {content: ''},
                    "code::after": {content: ''}
                }
            }
        }
    }
},
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
