import type UserConfig from "@11ty/eleventy/UserConfig";

export default function (eleventyConfig: UserConfig) {
  eleventyConfig.addPassthroughCopy({ "public/": "/" });
  eleventyConfig.setServerOptions({ watch: ["_site/js/**/*.js"] });

  return {
    dir: {
      input: "content",
      includes: "../_includes",
      data: "../_data",
    },
  };
}
