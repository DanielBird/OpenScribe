// Turns a DocModel into a .docx file with the `docx` library.
import { BorderStyle, Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import type { DocModel } from './docxModel';

/** Sizes in half-points; spacing in twips (1/20 pt). */
const FONT = 'Calibri';
const FONT_SIZE = 22;
const TURN_SPACING_AFTER = 120;
const META_SPACING_AFTER = 240;
const TIMESTAMP_COLOR = '666666';
const RULE_COLOR = 'BFBFBF';

// Characters XML 1.0 doesn't allow (control characters, U+FFFE/U+FFFF, unpaired surrogates). One of them
// in a file name or a translation would make Word report the file as damaged.
const XML_INVALID =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

export function xmlSafe(text: string): string {
  return text.replace(XML_INVALID, '');
}

export function renderDocx(model: DocModel): Promise<Blob> {
  const lastMeta = model.meta.length - 1;
  const document = new Document({
    title: xmlSafe(model.properties.title),
    creator: 'DeScribe',
    description: xmlSafe(model.properties.description),
    styles: { default: { document: { run: { font: FONT, size: FONT_SIZE } } } },
    sections: [
      {
        children: [
          new Paragraph({ text: xmlSafe(model.title), heading: HeadingLevel.HEADING_1 }),
          // A thin rule under the last row separates the details from the transcript.
          ...model.meta.map(
            (row, i) =>
              new Paragraph({
                children: [
                  new TextRun({ text: `${xmlSafe(row.label)}: `, bold: true }),
                  new TextRun(xmlSafe(row.value)),
                ],
                ...(i === lastMeta && {
                  border: {
                    bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE_COLOR, space: 4 },
                  },
                  spacing: { after: META_SPACING_AFTER },
                }),
              }),
          ),
          ...model.paragraphs.map(
            (p) =>
              new Paragraph({
                spacing: { after: TURN_SPACING_AFTER },
                children: [
                  new TextRun({ text: `[${p.timestamp}] `, color: TIMESTAMP_COLOR }),
                  new TextRun({ text: `${xmlSafe(p.speaker)}: `, bold: true }),
                  new TextRun(xmlSafe(p.text)),
                ],
              }),
          ),
        ],
      },
    ],
  });
  return Packer.toBlob(document);
}
