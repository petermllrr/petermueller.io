interface EleventyConfig {
  addPassthroughCopy(
    paths: string | Record<string, string>,
  ): void;
}

export default function (eleventyConfig: EleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "public/": "/" });

  return {
    dir: {
      input: "content",
      includes: "../_includes",
      data: "../_data",
      output: "_site",
    },
    templateFormats: ["md", "liquid", "html"],
    markdownTemplateEngine: "liquid",
    htmlTemplateEngine: "liquid",
  };
}
