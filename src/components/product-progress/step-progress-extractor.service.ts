import { Injectable } from '@nestjs/common';
import { CellObject, read, WorkSheet } from 'xlsx';
import { entries } from '../../common';
import { cellAsNumber, cellAsString } from '../../common/xlsx.util';
import { ILogger, Logger } from '../../core';
import { Downloadable, FileNode } from '../file';
import { ProductStep as Step } from '../product';
import { findStepColumns } from '../product/product-extractor.service';
import { StepProgressInput } from './dto';

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

    const stepColumns = findStepColumns(sheet, 'R19:AB19');

    return findProductProgressRows(sheet).map(
      parseProgressRow(sheet, stepColumns)
    );
  }
}

function findProductProgressRows(sheet: WorkSheet) {
  const matchedRows = [];
  let row = 23;
  while (cellAsString(sheet[`P${row}`]) !== 'Other Goals and Milestones') {
    if (
      cellAsString(sheet[`P${row}`]) &&
      (cellAsNumber(sheet[`Q${row}`]) ?? 0) > 0
    ) {
      matchedRows.push(row);
    }
    row++;
  }
  return matchedRows;
}

const parseProgressRow =
  (sheet: WorkSheet, stepColumns: Record<Step, string>) => (row: number) => {
    const bookName = cellAsString(sheet[`P${row}`])!; // Asserting bc loop verified this
    const totalVerses = cellAsNumber(sheet[`Q${row}`])!;
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
    return { bookName, totalVerses, steps };
  };
