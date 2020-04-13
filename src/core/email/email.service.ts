import { Injectable } from '@nestjs/common';
import { SES } from 'aws-sdk';
import { SendEmailRequest } from 'aws-sdk/clients/ses';
import { promises as fs } from 'fs';
import { fromString as htmlToText } from 'html-to-text';
import * as textFormatters from 'html-to-text/lib/formatter';
import { render } from 'mjml-react';
import * as open from 'open';
import { createElement, ReactElement } from 'react';
import { file as tempFile } from 'tempy';
import { assert } from 'ts-essentials';
import { ConfigService, ILogger, Logger } from '..';
import { Many, many, maybeMany, sleep } from '../../common';
import { RenderForText } from './templates/text-rendering';

@Injectable()
export class EmailService {
  constructor(
    private readonly ses: SES,
    private readonly config: ConfigService,
    @Logger('email') private readonly logger: ILogger
  ) {}

  async send<P>(
    to: Many<string>,
    template: (props: P) => ReactElement,
    props: P
  ): Promise<void> {
    const logProps = {
      type: template.name,
      to: many(to),
      props,
    };
    this.logger.debug('Sending email', logProps);

    const { send, open } = this.config.email;

    const docEl = template(props);
    const subject = this.getTitleFromMjml(docEl);

    const html = this.renderHtml(docEl);
    const text = this.renderText(docEl);

    if (send) {
      await this.sesSend(to, subject, html, text);
      this.logger.info('Sent email', logProps);
      return;
    }

    this.logger.debug('Would have sent email if enabled', {
      to,
      text,
    });

    if (open) {
      await this.openEmail(html);
    }
  }

  private async sesSend(
    to: Many<string>,
    subject: string,
    html: string,
    text: string
  ) {
    const { from, replyTo } = this.config.email;
    const utf8 = (data: string) => ({ Data: data, Charset: 'UTF-8' });
    const req: SendEmailRequest = {
      Source: from,
      Destination: {
        ToAddresses: many(to).slice(),
      },
      ReplyToAddresses: maybeMany(replyTo)?.slice(),
      Message: {
        Subject: utf8(subject),
        Body: { Html: utf8(html), Text: utf8(text) },
      },
    };
    try {
      await this.ses.sendEmail(req).promise();
    } catch (e) {
      this.logger.error('Failed to send email', { exception: e });
      throw e; // TODO What are the cases where an error is thrown and should we swallow?
    }
  }

  private getTitleFromMjml(mjml: ReactElement) {
    const head = findChildOfType(mjml, 'MjmlHead');
    const titleEl = findChildOfType(head, 'MjmlTitle');
    const title = titleEl.props.children;
    assert(title && typeof title === 'string', 'Title must be given');
    return title;
  }

  private renderHtml(templateEl: ReactElement) {
    const { html } = render(templateEl);
    return html;
  }

  private renderText(templateEl: ReactElement) {
    const { html: htmlForText } = render(
      createElement(RenderForText, null, templateEl)
    );

    const text = htmlToText(htmlForText, {
      ignoreImage: true,
      hideLinkHrefIfSameAsText: true,
      tables: true, // Filter manually below
      format: {
        // mjml uses `role="presentation"` for non-table tables, skip those.
        // actual tables get rendered as normal.
        table: (el, walk, options) => {
          return el.attribs.role === 'presentation'
            ? walk(el.children || [], options)
            : textFormatters.table(el, walk, options);
        },
        text: (el, options) => {
          return `${textFormatters.text(el, options)}\n`;
        },
      },
    });

    return text;
  }

  private async openEmail(html: string) {
    const temp = tempFile({ extension: 'html' });
    await fs.writeFile(temp, html);
    await open(`file://${temp}`);
    // try to wait for chrome to open before deleting temp file
    await sleep(1_000);
    await fs.unlink(temp);
  }
}

const findChildOfType = (el: ReactElement, type: string) => {
  const child = many(el.props.children).find(isType(type));
  assert(child, `Could not find child of type: ${type}`);
  return child;
};

const isType = (type: string) => (el?: ReactElement): el is ReactElement =>
  !!el && typeof el.type !== 'string' && el.type.name === type;
