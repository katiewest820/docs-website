const html = require('rehype-stringify');
const unified = require('unified');
const removeImports = require('remark-mdx-remove-imports');
const removeExports = require('remark-mdx-remove-exports');
const addAbsoluteImagePath = require('../../rehype-plugins/utils/addAbsoluteImagePath');

const htmlGenerator = unified()
  .use(removeImports)
  .use(removeExports)
  .use(addAbsoluteImagePath)
  .use(html);

const securityBulletinsQuery = async (graphql) => {
  const query = `
    {
      site {
        siteMetadata {
          title
          siteUrl
        }
      }
      securityBulletinFileNodes: allFile(
        filter: {childMdx: {fileAbsolutePath: {regex: "/src/content/docs/security/new-relic-security/security-bulletins/.*(?<!index).mdx/"}}}
      ) {
        nodes {
          birthTime(formatString: "YYYY-MM-DD")
          childMdx {
            frontmatter {
              title
              metaDescription
            }
            slug
            mdxAST
          }
        }
      }
    }
    `;

  const { data } = await graphql(query);

  return data;
};

const getFeedItem = (node, siteMetadata) => {
  const { birthTime, childMdx } = node;
  const { frontmatter, slug, mdxAST } = childMdx;
  const { title } = frontmatter;

  const transformedAST = htmlGenerator.runSync(mdxAST);
  const html = htmlGenerator.stringify(toHast(transformedAST));

  // time is necessary for RSS validity
  const date = parseISO(birthTime);
  const pubDate = `${format(date, 'EE, dd LLL yyyy')} 00:00:00 +0000`;
  const link = new URL(slug, siteMetadata.siteUrl).href;
  const id = Buffer.from(`${birthTime}-${title}`).toString('base64');

  return {
    guid: id,
    title,
    custom_elements: [
      { link },
      { pubDate },
      { 'content:encoded': html },
      { description: `CreatedOn: ${pubDate}.` },
    ],
  };
};

const generateFeed = (publicDir, siteMetadata, reporter, bulletinNodes) => {
  const title = `New Relic security bulletins`;

  const feedPath = path.join('security-bulletins', 'feed.xml');

  // https://github.com/dylang/node-rss#feedoptions
  const feedOptions = {
    title,
    feed_url: new URL(feedPath, siteMetadata.siteUrl).href,
    site_url: siteMetadata.siteUrl,
  };

  reporter.info(`\t${feedOptions.feed_url}`);

  const feed = new RSS(feedOptions);

  bulletinNodes.nodes.map((node) => {
    feed.item(getFeedItem(node, siteMetadata));
  });

  const filepath = path.join(publicDir, feedPath);
  const dir = path.dirname(filepath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filepath, feed.xml());
};

exports.onPostBuild = async ({ graphql, store, reporter }) => {
  const { program } = store.getState();
  const publicDir = path.join(program.directory, 'public');

  try {
    reporter.info(`Generating XML for security bulletins RSS feed`);
    const { site, securityBulletinFileNodes } = await securityBulletinsQuery(
      graphql
    );

    generateFeed(
      publicDir,
      site.siteMetadata,
      reporter,
      securityBulletinFileNodes
    );

    reporter.info('\tDone!');
  } catch (error) {
    reporter.panicOnBuild(
      `Unable to create security bulletins RSS feed: ${error}`,
      error
    );
  }
};