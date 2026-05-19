/**
 * @license
 * Copyright 2020-2026 Álvaro García
 * www.binarynonsense.com
 * SPDX-License-Identifier: BSD-2-Clause
 */

const temp = require("./temp");
const fileFormats = require("./file-formats");
const { FileDataType } = require("./constants");
const log = require("./logger");
const sharp = require("sharp");

function getArchiveType(fileDataType) {
  switch (fileDataType) {
    case FileDataType.ZIP:
      return "zip";
    case FileDataType.RAR:
      return "rar";
    case FileDataType.SEVENZIP:
      return undefined;
    default:
      return undefined;
  }
}

async function extractComicInfoXml(fileData) {
  if (!fileData?.metadata?.comicInfoId) return undefined;
  if (
    fileData.type !== FileDataType.ZIP &&
    fileData.type !== FileDataType.RAR &&
    fileData.type !== FileDataType.SEVENZIP
  ) {
    return undefined;
  }

  let tempFolderPath;
  try {
    tempFolderPath = temp.createSubFolder();
    const result = await fileFormats.extract7ZipEntryBuffer(
      fileData.path,
      fileData.metadata.comicInfoId,
      fileData.password,
      tempFolderPath,
      getArchiveType(fileData.type),
    );
    if (!result.success || !result.data) return undefined;
    return result.data.toString("utf8");
  } catch (error) {
    log.debug("ComicInfo.xml TOC extraction failed");
    log.error(error);
    return undefined;
  } finally {
    if (tempFolderPath) temp.deleteSubFolder(tempFolderPath);
  }
}

function normalizePageNodes(pagesNode) {
  if (!pagesNode) return [];
  const pageNodes = pagesNode.Page;
  if (Array.isArray(pageNodes)) return pageNodes;
  if (pageNodes) return [pageNodes];
  return [];
}

function parseTocFromComicInfoXml(xml, numPages) {
  if (!xml || typeof xml !== "string") return [];

  try {
    const { XMLParser, XMLValidator } = require("fast-xml-parser");
    const isValidXml = XMLValidator.validate(xml);
    if (isValidXml !== true) return [];

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
      trimValues: true,
    });
    const json = parser.parse(xml);
    const pageNodes = normalizePageNodes(json?.ComicInfo?.Pages);

    const toc = [];
    for (const page of pageNodes) {
      if (page?.Bookmark === undefined || page?.Image === undefined) continue;

      const title = String(page.Bookmark).trim();
      const pageIndex = Number(page.Image);
      if (
        title.length === 0 ||
        !Number.isInteger(pageIndex) ||
        pageIndex < 0 ||
        pageIndex >= numPages
      ) {
        continue;
      }

      toc.push({ title, pageIndex });
    }

    return toc;
  } catch (error) {
    log.debug("ComicInfo.xml TOC parsing failed");
    log.error(error);
    return [];
  }
}

exports.parseTocFromComicInfoXml = parseTocFromComicInfoXml;

function normalizeComicInfoPageType(type) {
  if (type === undefined || type === null) return undefined;
  const value = String(type).trim().toLowerCase();
  switch (value) {
    case "frontcover":
      return "frontcover";
    case "rightpage":
      return "rightpage";
    case "leftpage":
      return "leftpage";
    default:
      return undefined;
  }
}

function parsePageLayoutFromComicInfoXml(xml, numPages) {
  if (!xml || typeof xml !== "string") return [];

  try {
    const { XMLParser, XMLValidator } = require("fast-xml-parser");
    const isValidXml = XMLValidator.validate(xml);
    if (isValidXml !== true) return [];

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
      trimValues: true,
    });
    const json = parser.parse(xml);
    const pageNodes = normalizePageNodes(json?.ComicInfo?.Pages);

    const pageLayout = new Array(numPages).fill(undefined);
    for (const page of pageNodes) {
      if (page?.Image === undefined || page?.Type === undefined) continue;

      const pageIndex = Number(page.Image);
      const pageType = normalizeComicInfoPageType(page.Type);
      if (
        !pageType ||
        !Number.isInteger(pageIndex) ||
        pageIndex < 0 ||
        pageIndex >= numPages
      ) {
        continue;
      }

      pageLayout[pageIndex] = pageType;
    }

    return pageLayout;
  } catch (error) {
    log.debug("ComicInfo.xml page layout parsing failed");
    log.error(error);
    return [];
  }
}

exports.parsePageLayoutFromComicInfoXml = parsePageLayoutFromComicInfoXml;

exports.loadPageLayoutFromComicInfo = async function (fileData) {
  const xml = await extractComicInfoXml(fileData);
  return parsePageLayoutFromComicInfoXml(xml, fileData?.numPages || 0);
};

function parseMangaDirectionFromComicInfoXml(xml) {
  if (!xml || typeof xml !== "string") return undefined;

  try {
    const { XMLParser, XMLValidator } = require("fast-xml-parser");
    const isValidXml = XMLValidator.validate(xml);
    if (isValidXml !== true) return undefined;

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
      trimValues: true,
    });
    const json = parser.parse(xml);
    const mangaValue = json?.ComicInfo?.Manga;
    if (mangaValue === undefined || mangaValue === null) return undefined;

    return String(mangaValue).trim().toLowerCase();
  } catch (error) {
    log.debug("ComicInfo.xml Manga direction parsing failed");
    log.error(error);
    return undefined;
  }
}

exports.parseMangaDirectionFromComicInfoXml = parseMangaDirectionFromComicInfoXml;

exports.loadMangaDirectionFromComicInfo = async function (fileData) {
  const xml = await extractComicInfoXml(fileData);
  return parseMangaDirectionFromComicInfoXml(xml);
};

async function extractPageImageBuffer(fileData, pageIndex) {
  const entryName = fileData?.pagesPaths?.[pageIndex];
  if (!entryName) return undefined;
  if (
    fileData.type !== FileDataType.ZIP &&
    fileData.type !== FileDataType.RAR &&
    fileData.type !== FileDataType.SEVENZIP
  ) {
    return undefined;
  }

  let tempFolderPath;
  try {
    tempFolderPath = temp.createSubFolder();
    const result = await fileFormats.extract7ZipEntryBuffer(
      fileData.path,
      entryName,
      fileData.password,
      tempFolderPath,
      getArchiveType(fileData.type),
    );
    if (!result.success || !result.data) return undefined;
    return result.data;
  } catch (error) {
    log.debug("ComicInfo.xml TOC thumbnail extraction failed");
    log.error(error);
    return undefined;
  } finally {
    if (tempFolderPath) temp.deleteSubFolder(tempFolderPath);
  }
}

async function createPageThumbnailDataUrl(fileData, pageIndex) {
  try {
    const imageBuffer = await extractPageImageBuffer(fileData, pageIndex);
    if (!imageBuffer) return undefined;

    const thumbnailBuffer = await sharp(imageBuffer)
      .rotate()
      .resize(72, 104, {
        fit: "cover",
        position: "top",
      })
      .jpeg({ quality: 74, mozjpeg: true })
      .toBuffer();

    return `data:image/jpeg;base64,${thumbnailBuffer.toString("base64")}`;
  } catch (error) {
    log.debug("ComicInfo.xml TOC thumbnail creation failed");
    log.error(error);
    return undefined;
  }
}

async function addThumbnailsToToc(fileData, toc) {
  const entries = [];
  for (const entry of toc) {
    entries.push({
      ...entry,
      thumbnail: await createPageThumbnailDataUrl(fileData, entry.pageIndex),
    });
  }
  return entries;
}

exports.loadTocFromComicInfo = async function (fileData) {
  const xml = await extractComicInfoXml(fileData);
  const toc = parseTocFromComicInfoXml(xml, fileData?.numPages || 0);
  return addThumbnailsToToc(fileData, toc);
};
