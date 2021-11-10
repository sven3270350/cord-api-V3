import { Injectable } from '@nestjs/common';
import { MergeExclusive } from 'type-fest';
import { CellObject, read, WorkSheet } from 'xlsx';
import { entries } from '../../common';
import { cellAsNumber, cellAsString, sheetRange } from '../../common/xlsx.util';
import { ILogger, Logger } from '../../core';
import { Downloadable, FileNode } from '../file';
import { ProductStep as Step } from '../product';
import { findStepColumns } from '../product/product-extractor.service';
import { Book } from '../scripture/books';
import { StepProgressInput } from './dto';

type ExtractedRow = MergeExclusive<
  {
    bookName: string;
    totalVerses: number;
  },
  { story: string }
> & {
  steps: ReadonlyArray<{ step: Step; completed?: number | null }>;
};

@Injectable()
export class StepProgressExtractor {
  constructor(
    @Logger('step-progress:extractor') private readonly logger: ILogger
  ) {}

  async extract(file: Downloadable<FileNode>) {
    const buffer = await file.download();
    const pnp = read(buffer, { type: 'buffer' });

    const sheet = pnp.Sheets.Progress;
    if (!sheet) {
      this.logger.warning('Unable to find progress sheet in pnp file', {
        name: file.name,
        id: file.id,
      });
      return [];
    }

    const isOBS = cellAsString(sheet.P19) === 'Stories';

    const stepColumns = findStepColumns(sheet, 'R19:AB19');

    return findProductProgressRows(sheet, isOBS).map(
      parseProgressRow(sheet, stepColumns, isOBS)
    );
  }
}

function findProductProgressRows(sheet: WorkSheet, isOBS: boolean) {
  const lastRow = sheetRange(sheet)?.e.r ?? 200;
  const matchedRows = [];
  let row = 23;
  while (
    row < lastRow &&
    cellAsString(sheet[`P${row}`]) !== 'Other Goals and Milestones'
  ) {
    if (isProductRow(sheet, isOBS, row)) {
      matchedRows.push(row);
    }
    row++;
  }
  return matchedRows;
}

const isProductRow = (sheet: WorkSheet, isOBS: boolean, row: number) => {
  if (isOBS) {
    return !!cellAsString(sheet[`Q${row}`]);
  }
  const book = Book.tryFind(cellAsString(sheet[`P${row}`]));
  const totalVerses = cellAsNumber(sheet[`Q${row}`]) ?? 0;
  return book && totalVerses > 0 && totalVerses <= book.totalVerses;
};

const parseProgressRow =
  (sheet: WorkSheet, stepColumns: Record<Step, string>, isOBS: boolean) =>
  (row: number): ExtractedRow => {
    const progress = (column: string) => {
      const cell: CellObject = sheet[`${column}${row}`];
      if (cellAsString(cell)?.startsWith('Q')) {
        // Q# means completed that quarter
        return 100;
      }
      const percentDecimal = cellAsNumber(cell);
      return percentDecimal ? percentDecimal * 100 : undefined;
    };
    const steps = entries(stepColumns).map(
      ([step, column]): StepProgressInput => ({
        step,
        completed: progress(column),
      })
    );
    if (isOBS) {
      const story = cellAsString(sheet[`Q${row}`])!; // Asserting bc loop verified this
      return { story, steps };
    }
    const bookName = cellAsString(sheet[`P${row}`])!; // Asserting bc loop verified this
    const totalVerses = cellAsNumber(sheet[`Q${row}`])!; // Asserting bc loop verified this
    return { bookName, totalVerses, steps };
  };
