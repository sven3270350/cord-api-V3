import { applyDecorators } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import { Book } from '../books';
import { ScriptureReferenceInput } from './scripture-reference.dto';

class ScriptureReferenceStartInput extends ScriptureReferenceInput {
  chapter = 1;
  verse = 1;
}

class ScriptureReferenceEndInput implements ScriptureReferenceInput {
  chapter: number;
  verse: number;
  private bookName: string;

  get book() {
    return this.bookName;
  }

  set book(value: string) {
    this.bookName = value;
    // when book is set, default the chapter & verse to last
    // If they are also given on input then they will just be overridden
    // after this. Also ignoring errors, as the validator reports better.
    try {
      const book = Book.find(value);
      this.chapter = book.lastChapter.chapter;
      this.verse = book.lastChapter.lastVerse.verse;
    } catch (e) {
      // let validator will throw error
    }
  }
}

export const ScriptureStart = () =>
  applyDecorators(
    ValidateNested(),
    // @Transform doesn't work with nested validators, so using a custom class instead.
    Type(() => ScriptureReferenceStartInput) as PropertyDecorator
  );

export const ScriptureEnd = () =>
  applyDecorators(
    ValidateNested(),
    // @Transform doesn't work with nested validators, so using a custom class instead.
    Type(() => ScriptureReferenceEndInput) as PropertyDecorator
  );
