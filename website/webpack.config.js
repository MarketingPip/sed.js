const path = require('path');
const glob = require('glob'); // Added for PurgeCSS
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CopyPlugin = require('copy-webpack-plugin'); 
const { PurgeCSSPlugin } = require('purgecss-webpack-plugin'); // Added PurgeCSS

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';

  const entries = {
    index: path.resolve(__dirname, 'js/main.js'),
    playground: path.resolve(__dirname, 'js/playground.js'),
    // 1. Give FontAwesome its own entry so Webpack creates a standalone CSS file for it
    fontawesome: '@fortawesome/fontawesome-free/css/all.min.css'
  };

  const htmlPages =[
    { template: 'pages/index.html', filename: 'index.html', entry: 'index' },
    { template: 'pages/playground.html', filename: 'playground.html', entry: 'playground' },
  ];

  return {
    entry: entries,
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].[contenthash].js',
      clean: true,
      publicPath: '', 
    },
    devtool: isProd ? false : 'source-map',
    module: {
      rules:[
        {
          test: /\.css$/i,
          use:[
            isProd ? MiniCssExtractPlugin.loader : 'style-loader',
            'css-loader',
            'postcss-loader', // Tailwind is purged securely here
          ],
        },
        {
          test: /\.(woff|woff2|eot|ttf|otf)$/i,
          type: 'asset/resource',
          generator: {
            filename: 'webfonts/[name][ext][query]',
          },
        },
        {
          test: /\.html$/i,
          loader: "html-loader",
          options: {
            minimize: { decodeEntities: false },
          },
        },
      ],
    },
    resolve: {
      modules: [path.resolve(__dirname, 'node_modules'), 'node_modules'],
      extensions:['.js', '.json', '.wasm', '.woff'],
    },
    plugins:[
      new CopyPlugin({
        patterns:[
          {
            from: path.resolve(__dirname, 'node_modules/@fortawesome/fontawesome-free/webfonts'),
            to: path.resolve(__dirname, 'dist/webfonts'), 
          },
        ],
      }),
      
      ...htmlPages.map(page => new HtmlWebpackPlugin({
        template: path.resolve(__dirname, page.template),
        filename: page.filename,
        // Inject both the page-specific JS and the isolated FontAwesome chunk
        chunks: [page.entry, 'fontawesome'],
      })),

      new MiniCssExtractPlugin({
        filename: '[name].[contenthash].css', 
      }),

      // 2. Run PurgeCSS at the end of the build ONLY on the fontawesome CSS file
      isProd && new PurgeCSSPlugin({
        paths:[
          ...glob.sync(path.join(__dirname, 'pages/**/*.html'), { nodir: true }),
          ...glob.sync(path.join(__dirname, 'js/**/*.js'), { nodir: true }),
        ],
        only: ['fontawesome'], // Crucial: Restricts PurgeCSS to ONLY your Font Awesome chunk
        safelist:['fa', 'fas', 'far', 'fab', 'fa-solid', 'fa-regular', 'fa-brands']
      })
    ].filter(Boolean), // .filter(Boolean) prevents the plugin from crashing in development mode
    mode: isProd ? 'production' : 'development',
  };
};
