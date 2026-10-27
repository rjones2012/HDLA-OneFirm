import { NextResponse } from 'next/server';
import {
  Document, Packer, Paragraph, TextRun, Header, Footer,
  AlignmentType, TabStopType, PageBreak, PageNumber, BorderStyle
} from 'docx';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { requireCaller, LEADERSHIP } from '../../../lib/apiAuth';

export const dynamic = 'force-dynamic';

// ─── LOCKED CONSTANTS ─────────────────────────────────────────────────────────
const FB = 'Lato Light';
const FT = 'Flecha M';
const RIGHT_TAB = 10080; // 12240 page - 1080L - 1080R margins

const PARTNER_NAMES = {
  RJ: 'Richie Jones', CB: 'Chris Barkley', MB: 'Michael Black', TJ: 'TJ Eliason',
};

// LOCKED: fee chart — exact roles/rates from canonical proposal
const FEE_CHART_ROWS = [
  ['Partner', '$195/hr.'],
  ['Principal', '$165/hr.'],
  ['Project Manager', '$135/hr.'],
  ['Senior Project Designer', '$115/hr.'],
  ['Project Designer', '$95/hr.'],
  ['Office Manager', '$50/hr.'],
];

// LOCKED: all boilerplate text — never comes from AI JSON
const LOCKED = {
  exclusionsIntro: 'These are services that may be required that are not a part of or are out of sequence with the basic services and are specifically excluded from HDLA\u2019s scope of work. They include:',
  additionalServicesIntro: 'These are services which may be required that are not a part of or are out of sequence to the basic services. They include:',
  fundingWarranty: 'In contracting HDLA for professional services, the Client warrants that funds are available to compensate HDLA for the total amount of services and expenses contracted and that these funds are neither encumbered nor contingent upon the granting of approvals, permits, or financial commitments by lending institutions or third parties.',
  tcReference: 'Attached to and a part of this agreement are standard Terms and Conditions of the Agreement. In signing this agreement, the Client is also agreeing to the Terms and Conditions attached herein.',
  termination: 'The client or HDLA may terminate this agreement for reasons which may arise. In the event such termination becomes necessary, the party effecting termination shall so notify the other party, and termination will become effective seven (7) calendar days after receipt of the termination notice. Irrespective of which party shall affect termination or the cause thereof, the Client shall, within thirty (30) calendar days of termination, remunerate HDLA for services.',
  closing: 'We appreciate the opportunity to be of service. If you are in agreement, please sign below and return one copy for our files.',
  reimbursables: (rate) => `Excluded from the basic fee would be reimbursable expenses incurred on the Owner\u2019s behalf including photocopies, printing, plotting, postage, fax, overnight services, courier service, photography, travel, mileage @ ${rate || '.725'}/mile and per diem expenses. All money over 30 days shall be assessed 1% interest per month.`,
  billedAtCost: 'Reimbursable expenses shall be billed at cost.',
  billingMonthly: 'Billing will be monthly for all work performed and expenses incurred on your behalf.',
  holdClause: 'HDLA reserves the right to provide an updated proposal for Landscape Architecture services should the project go on hold for a period of greater than twelve (12) months.',
  feesRepresent: (year) => `Above fees represent HDLA ${year || '2026'} Hourly Rates.`,
};

// LOCKED: T&C — 15 sections verbatim from canonical
const TC_SECTIONS = [
  { num: '1', title: 'ACCESS TO THE SITE/JOBSITE SAFETY:', initials: false, paragraphs: [
    'Unless otherwise stated, HDLA, hereinafter referred to as the CONSULTANT, will have access to the site for activities necessary for the performance of the services. The CONSULTANT will take precautions to minimize damage resulting for these activities, but has not included in the project fee the cost of restoration of any resulting damage.',
    'The CONSULTANT has not been retained or compensated to provide design and construction observation services related to the CONTRACTOR\u2019S safety precautions or to means, methods, techniques, sequences or procedures for the CONTRACTOR to perform his work. The CLIENT understands that the CONSULTANT is not responsible, in any way, for the means, methods, techniques, sequences, procedures, or scheduling of construction, or for jobsite safety, and will not be responsible for any losses or injuries that occur at the Project site.',
  ]},
  { num: '2', title: 'INDEMNIFICATION:', initials: false, paragraphs: [
    'The CONSULTANT agrees, to the fullest extent permitted by law, to indemnify and hold the Client harmless from any damage, liability or cost (including reasonable attorneys\u2019 fees and costs of defense) to the extent caused by the CONSULTANT\u2019S negligent acts, errors or omissions in the performance of professional services under this Agreement and those of his or her subconsultants or anyone for whom the CONSULTANT is legally liable.',
    'The Client agrees, to the fullest extent permitted by law, to indemnify and hold the CONSULTANT harmless from any damage, liability or cost (including reasonable attorney\u2019s fees and costs of defense) to the extent caused by the Client\u2019s negligent acts, errors or omissions and those of his or her contractors, subcontractors or consultants or anyone for whom the Client is legally liable, and arising from the project that is the subject of this agreement.',
    'The CONSULTANT is not obligated to indemnify the Client in any manner whatsoever for the Client\u2019s own negligence.',
  ]},
  { num: '3', title: 'INSURANCE:', initials: false, paragraphs: [
    'The CONSULTANT shall secure and endeavor to maintain such insurance as will protect the CLIENT from claims of negligence, bodily injury, death, or property damage that may arise out of the performance of the CONSULTANTs services under this agreement.',
  ]},
  { num: '4', title: 'RISK ALLOCATION/LIMITATION OF LIABILITY:', initials: true, paragraphs: [
    'In recognition of the relative risks and benefits of the Project to both the Client and the Consultant, the risks have been allocated such that the Client agrees, to the fullest extent permitted by law, to limit the liability of the Consultant and Consultant\u2019s officers, directors, partners, employees, shareholders, owners and subconsultants for any and all claims, losses, costs, or damages of any nature whatsoever or claims expenses from any cause or causes, including attorneys\u2019 fees and costs and expert-witness fees and costs, so that the total aggregate liability of the Consultant and Consultant\u2019s officers, directors, partners, employees, shareholders, owners and subconsultants shall not exceed $100,000.00, or the Consultant\u2019s total fee for services rendered on this Project, whichever is greater (the \u201CLimitation Amount\u201D), and further, in no event shall the Limitation Amount exceed the amount of insurance proceeds actually available to the Consultant for the claim at issue at the time of settlement or final judgment net of any and all expenses paid or incurred on the claim at issue, payments made or incurred in connection with other claims made against the Consultant, or any other circumstances which may reduce, impair, or eliminate the overall availability of such insurance to the Consultant. It is intended that this limitation apply to any and all liability or cause of action, or cause of action, including without limitation active and passive negligence, however alleged or arising, unless otherwise prohibited by law. The Client specifically agrees that it has had the opportunity to negotiate this Limitation of Liability clause and to accept or reject its inclusion herein.',
  ]},
  { num: '5', title: 'TERMINATION OF SERVICES:', initials: false, paragraphs: [
    'This Agreement may be terminated by the CLIENT or by the CONSULTANT upon not less than seven days written notice should the other party fail to substantially perform in accordance with the terms of this Agreement through no fault of the party initiating termination. If this Agreement is terminated by the CLIENT, the CONSULTANT shall be paid for services performed to the termination notice date, including reimbursable expenses due plus termination expenses. Termination expenses are defined as reimbursable expenses directly attributed to termination, plus 15% of the total compensation earned to the time of termination to account for the CONSULTANT\u2019s rescheduling adjustments, reassignment of personnel and related costs incurred due to termination.',
  ]},
  { num: '6', title: 'REIMBURSABLE EXPENSES:', initials: false, paragraphs: [
    'Reimbursable expenses include actual expenditures made by the CONSULTANT, his employees, or his SUB-CONSULTANTS on behalf of the Project. Reimbursable expenses include, but are not necessarily limited to, the following: (a) expense of transportation and living when traveling in connection with the Project; long distance calls; overnight mail; telecopies; and fees paid for testing and/or for securing approval of authorities having jurisdiction over the Project; (b) expenses of printing, reproduction, postage and handling of drawings and specifications, including duplicate sets at the completion of each phase of the Project for the CLIENT\u2019s review and approval: and (c) expenses related to SUB-CONSULTANTS and specialists when authorized by the CLIENT. Reimbursable expenses shall be billed at the cost incurred by the CONSULTANT.',
  ]},
  { num: '7', title: 'DISPUTES RESOLUTION:', initials: false, paragraphs: [
    'All claims, counterclaims, disputes and other matters in question between the parties hereto arising out of or relating to this Agreement or breach thereof shall be presented to non-binding mediation, subject to the parties agreeing to a mediator.',
  ]},
  { num: '8', title: 'OWNERSHIP OF DOCUMENTS:', initials: false, paragraphs: [
    'It is understood by and between the parties to this Agreement that all drawings, specifications and other work products of the CONSULTANT for this Project shall remain the property of the CONSULTANT and are instruments of the service for this Project only and shall apply to this particular Project and any reuse of instruments of service of the CONSULTANT by the CLIENT for any extensions of the PROJECT or for any other project without the written permission of the CONSULTANT shall be at the CLIENT\u2019s sole risk, and the CLIENT agrees to defend, indemnify and hold harmless the CONSULTANT for any unauthorized reuse of the CONSULTANT\u2019s instruments of service by the CLIENT or by others acting through or on behalf of the CLIENT. Any reuse or adaptation of the CONSULTANT\u2019s instruments of service on other projects shall entitle the CONSULTANT to additional compensation in an amount to be agreed upon by the CLIENT and the CONSULTANT.',
  ]},
  { num: '9', title: 'GOVERNING LAW:', initials: true, paragraphs: [
    'Unless otherwise specified within this Agreement, this Agreement shall be governed by the law of the State of Tennessee. In the event any provisions of this Agreement shall be held to be invalid and unenforceable, the remaining provisions shall be valid and binding upon the parties. One or more waivers by either party of any provision, term, condition or covenant shall not be construed by the other party as a waiver of a subsequent breach of the same by the other party.',
  ]},
  { num: '10', title: 'PAYMENT TO THE CONSULTANT:', initials: true, paragraphs: [
    'Fees for services shall be as provided in this Agreement. Where the approximate total fee is based on a manpower estimate and is to be billed on an hourly basis per the CONSULTANT\u2019s Standard Fee Schedule, this total fee shall be understood to be an estimate. If the CONSULTANT\u2019s estimate is exceeded by more than ten percent (10%), the CLIENT shall be so notified in advance.',
    'Progress payments shall be made in proportion to services rendered and as indicated within this Agreement and shall be due and owing within thirty days of the CONSULTANT\u2019s submittal of the monthly invoice. Past due amounts include a charge of 1 \u00BD% per month for interest from the thirtieth (30th) day.',
    'If the CLIENT fails to make monthly payments due the CONSULTANT, the CONSULTANT may, after giving seven days written notice to the CLIENT, suspend services under this Agreement and retain all work products deliverable to the CLIENT until full payment. The project completion date shall be automatically extended by the number of days services are suspended.',
    'No deductions shall be made from the CONSULTANT\u2019s compensation on account of penalty, liquidated damages, or other sums withheld from payment(s) to CONTRACTORS.',
    'If the Project is delayed or if the CONSULTANT\u2019s services for the Project are delayed or suspended for more than three months for reasons beyond the CONSULTANT\u2019s control, the CONSULTANT may, after giving seven days written notice to the CLIENT, terminate this Agreement, and the CLIENT shall compensate the CONSULTANT in accordance with the termination provision contained in this Agreement.',
  ]},
  { num: '11', title: 'CLIENT\u2019S RESPONSIBILITIES:', initials: true, paragraphs: [
    'The CLIENT shall designate a person to act with authority on his behalf in respect to all aspects of the Project, shall examine and respond within 14 days for notice periods to Consultant\u2019s submissions, and shall give prompt written notice to the CONSULTANT whenever he observes or otherwise becomes aware of any defect in or problem with the Project.',
    'The CLIENT shall also provide to the CONSULTANT all criteria and full information as to his requirements for the Project, and shall:',
    'Guarantee access to and make all provisions for the CONSULTANT to enter upon public and private properties as necessary to accomplish the work;',
    'Furnish approvals and permits from all governmental authorities and/or agencies having jurisdiction over the Project;',
    'Provide the CONSULTANT with means of access to all areas of the Project; this being necessary for the orderly progress of the work, the CONSULTANT shall be entitled to rely upon the efficiency and completeness thereof; and',
    'Compensate the CONSULTANT for services rendered under this Agreement.',
  ]},
  { num: '12', title: 'EXTENT OF AGREEMENT:', initials: false, paragraphs: [
    'This Agreement represents the entire and integrated Agreement between the CLIENT and the CONSULTANT and supersedes all prior negotiations, or agreements, either written or oral. This Agreement may be amended only by written instrument signed by both the CLIENT and the CONSULTANT.',
    'The CONSULTANT intends to render services under the terms of this Agreement in accordance with generally accepted professional practices consistent with the intended use of the Project and makes no warranty either expressed or implied.',
    'Any opinion of construction cost prepared by the CONSULTANT represents his judgment as a design professional and is supplied for the general guidance of the CLIENT. Since the CONSULTANT has no control over the cost of labor and material, or over competitive bidding or market conditions, the CONSULTANT does not guarantee the accuracy of such opinions as compared to CONTRACTOR bids or actual cost to the CLIENT.',
  ]},
  { num: '13', title: 'CHANGES TO THE SCOPE OF SERVICE:', initials: false, paragraphs: [
    'The CLIENT may request changes in the Scope of Services of the Agreement to be performed hereunder. Such changes, including any increase or decrease in the amount of the Consultant\u2019s compensation, which are mutually agreed upon by and between the CLIENT and the CONSULTANT shall be incorporated into this Agreement by written amendment. Any changes made to the construction documents by the CLIENT or the CLIENT\u2019s representatives are strictly prohibited without the knowledge and written consent of the CONSULTANT. The CONSULTANT shall be released from any liability resulting from damages, injuries, and or death resulting from the unauthorized alteration of construction documents.',
  ]},
  { num: '14', title: 'EXISTING AND/OR HIDDEN CONDITIONS:', initials: false, paragraphs: [
    'A condition is hidden if it is concealed by existing finishes or features or if it cannot be investigated by reasonable visual observation. If the CONSULTANT has reason to believe that such a condition may exist, the CONSULTANT will notify the CLIENT who then shall authorize and pay for all costs associated with the investigation of such a condition and, if necessary, all costs necessary to correct said condition. If (1) the CLIENT fails to authorize such investigation or correction after due notification, or (2) the CONSULTANT has no reason to believe that such a condition exists, the CLIENT is responsible for all risks associated with this condition, and the CONSULTANT shall not be responsible for the existing condition nor any resulting damages to persons or property. Further, the CONSULTANT will not be required to execute any document that would result in certifying, guaranteeing, or warranting the existence of conditions whose existence the CONSULTANT cannot reasonably ascertain.',
  ]},
  { num: '15', title: 'DESIGN WITHOUT CONSTRUCTION PHASE SERVICES:', initials: true, paragraphs: [
    'It is understood and agreed that the CONSULTANT\u2019S Basic Services under this Agreement may include limited project observation or review of the CONTRACTOR\u2019S performance and limited construction phase services, and that some such services may be provided by the ARCHITECT or by another party selected at the sole discretion of the CLIENT.',
    'If the CLIENT requests in writing that the CONSULTANT provide any specific construction phase services and if the CONSULTANT agrees in writing to provide such services, then the CONSULTANT shall be compensated for Additional Services as provided in this Agreement.',
  ]},
];

// ─── HEADER XML — verbatim from canonical proposal XML ───────────────────────
// These are injected directly into the docx zip after docx-js builds the body.
// rId1 in each header's .rels file points to the image file.

// Page 1 header: full "Hodgson Douglas Landscape Architects" logo
// Image: logo_full.png (881x218px), EMU: 1810512 x 448056
function headerXmlFull() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex"
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  xmlns:aink="http://schemas.microsoft.com/office/drawing/2016/ink"
  xmlns:am3d="http://schemas.microsoft.com/office/drawing/2017/model3d"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:oel="http://schemas.microsoft.com/office/2019/extlst"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
  xmlns:v="urn:schemas-microsoft-com:vml"
  xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:w10="urn:schemas-microsoft-com:office:word"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
  xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"
  xmlns:w16cex="http://schemas.microsoft.com/office/word/2018/wordml/cex"
  xmlns:w16cid="http://schemas.microsoft.com/office/word/2016/wordml/cid"
  xmlns:w16="http://schemas.microsoft.com/office/word/2018/wordml"
  xmlns:w16sdtdh="http://schemas.microsoft.com/office/word/2020/wordml/sdtdatahash"
  xmlns:w16sdtfl="http://schemas.microsoft.com/office/word/2022/wordml/sdtformatlock"
  xmlns:w16du="http://schemas.microsoft.com/office/word/2023/wordml/word16du"
  xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
  xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk"
  xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
  xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
  xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"
  mc:Ignorable="w14 w15 w16se w16cid w16 w16cex w16sdtdh w16sdtfl w16du wp14">
  <w:p>
    <w:pPr>
      <w:pStyle w:val="Header"/>
      <w:tabs>
        <w:tab w:val="clear" w:pos="4680"/>
        <w:tab w:val="clear" w:pos="9360"/>
      </w:tabs>
    </w:pPr>
    <w:r>
      <w:rPr><w:noProof/></w:rPr>
      <w:drawing>
        <wp:anchor distT="0" distB="0" distL="114300" distR="114300"
          simplePos="0" relativeHeight="251661312" behindDoc="1"
          locked="0" layoutInCell="1" allowOverlap="0"
          wp14:anchorId="0C7A79D8" wp14:editId="160F9F1D">
          <wp:simplePos x="0" y="0"/>
          <wp:positionH relativeFrom="column"><wp:align>right</wp:align></wp:positionH>
          <wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>
          <wp:extent cx="1810512" cy="448056"/>
          <wp:effectExtent l="0" t="0" r="0" b="9525"/>
          <wp:wrapNone/>
          <wp:docPr id="17" name="logo_full"/>
          <wp:cNvGraphicFramePr>
            <a:graphicFrameLocks noChangeAspect="1"/>
          </wp:cNvGraphicFramePr>
          <a:graphic>
            <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
              <pic:pic>
                <pic:nvPicPr>
                  <pic:cNvPr id="17" name="logo_full"/>
                  <pic:cNvPicPr>
                    <a:picLocks noChangeAspect="1" noChangeArrowheads="1"/>
                  </pic:cNvPicPr>
                </pic:nvPicPr>
                <pic:blipFill>
                  <a:blip r:embed="rId1">
                    <a:extLst>
                      <a:ext uri="{28A0092B-C50C-407E-A947-70E740481C1C}">
                        <a14:useLocalDpi val="0"/>
                      </a:ext>
                    </a:extLst>
                  </a:blip>
                  <a:stretch><a:fillRect/></a:stretch>
                </pic:blipFill>
                <pic:spPr bwMode="auto">
                  <a:xfrm><a:off x="0" y="0"/><a:ext cx="1810512" cy="448056"/></a:xfrm>
                  <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                  <a:noFill/>
                  <a:ln><a:noFill/></a:ln>
                </pic:spPr>
              </pic:pic>
            </a:graphicData>
          </a:graphic>
          <wp14:sizeRelH relativeFrom="margin"><wp14:pctWidth>0</wp14:pctWidth></wp14:sizeRelH>
          <wp14:sizeRelV relativeFrom="margin"><wp14:pctHeight>0</wp14:pctHeight></wp14:sizeRelV>
        </wp:anchor>
      </w:drawing>
    </w:r>
  </w:p>
</w:hdr>`;
}

// Default header (all pages after page 1): HDLA mark
// Image: logo_hdla.png (805x223px), EMU: 923544 x 256032
function headerXmlHdla() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex"
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  xmlns:aink="http://schemas.microsoft.com/office/drawing/2016/ink"
  xmlns:am3d="http://schemas.microsoft.com/office/drawing/2017/model3d"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:oel="http://schemas.microsoft.com/office/2019/extlst"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
  xmlns:v="urn:schemas-microsoft-com:vml"
  xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:w10="urn:schemas-microsoft-com:office:word"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
  xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"
  xmlns:w16cex="http://schemas.microsoft.com/office/word/2018/wordml/cex"
  xmlns:w16cid="http://schemas.microsoft.com/office/word/2016/wordml/cid"
  xmlns:w16="http://schemas.microsoft.com/office/word/2018/wordml"
  xmlns:w16sdtdh="http://schemas.microsoft.com/office/word/2020/wordml/sdtdatahash"
  xmlns:w16sdtfl="http://schemas.microsoft.com/office/word/2022/wordml/sdtformatlock"
  xmlns:w16du="http://schemas.microsoft.com/office/word/2023/wordml/word16du"
  xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
  xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk"
  xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
  xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
  xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"
  mc:Ignorable="w14 w15 w16se w16cid w16 w16cex w16sdtdh w16sdtfl w16du wp14">
  <w:p>
    <w:pPr><w:pStyle w:val="Header"/></w:pPr>
    <w:r>
      <w:rPr><w:noProof/></w:rPr>
      <w:drawing>
        <wp:anchor distT="0" distB="0" distL="114300" distR="114300"
          simplePos="0" relativeHeight="251659264" behindDoc="1"
          locked="0" layoutInCell="1" allowOverlap="0"
          wp14:anchorId="1286515C" wp14:editId="3BF3839C">
          <wp:simplePos x="0" y="0"/>
          <wp:positionH relativeFrom="column"><wp:align>right</wp:align></wp:positionH>
          <wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>
          <wp:extent cx="923544" cy="256032"/>
          <wp:effectExtent l="0" t="0" r="0" b="0"/>
          <wp:wrapNone/>
          <wp:docPr id="18" name="logo_hdla"/>
          <wp:cNvGraphicFramePr>
            <a:graphicFrameLocks noChangeAspect="1"/>
          </wp:cNvGraphicFramePr>
          <a:graphic>
            <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
              <pic:pic>
                <pic:nvPicPr>
                  <pic:cNvPr id="18" name="logo_hdla"/>
                  <pic:cNvPicPr>
                    <a:picLocks noChangeAspect="1" noChangeArrowheads="1"/>
                  </pic:cNvPicPr>
                </pic:nvPicPr>
                <pic:blipFill>
                  <a:blip r:embed="rId1">
                    <a:extLst>
                      <a:ext uri="{28A0092B-C50C-407E-A947-70E740481C1C}">
                        <a14:useLocalDpi val="0"/>
                      </a:ext>
                    </a:extLst>
                  </a:blip>
                  <a:stretch><a:fillRect/></a:stretch>
                </pic:blipFill>
                <pic:spPr bwMode="auto">
                  <a:xfrm><a:off x="0" y="0"/><a:ext cx="923544" cy="256032"/></a:xfrm>
                  <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                  <a:noFill/>
                  <a:ln><a:noFill/></a:ln>
                </pic:spPr>
              </pic:pic>
            </a:graphicData>
          </a:graphic>
          <wp14:sizeRelH relativeFrom="margin"><wp14:pctWidth>0</wp14:pctWidth></wp14:sizeRelH>
          <wp14:sizeRelV relativeFrom="margin"><wp14:pctHeight>0</wp14:pctHeight></wp14:sizeRelV>
        </wp:anchor>
      </w:drawing>
    </w:r>
  </w:p>
</w:hdr>`;
}

// Rels XML for each header — rId1 points to the image
const HEADER_RELS = (imgFilename) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
    Target="media/${imgFilename}"/>
</Relationships>`;

// ─── PARAGRAPH HELPERS ────────────────────────────────────────────────────────

function body(text, opts = {}) {
  if (!text && !opts.force) return null;
  return new Paragraph({
    spacing: { after: opts.after !== undefined ? opts.after : 160, before: opts.before || 0 },
    indent: opts.indent ? { left: opts.indent } : undefined,
    alignment: opts.align || undefined,
    children: [new TextRun({ text: text || '', font: opts.font || FB, size: opts.size || 20, bold: opts.bold || false, color: opts.color || undefined })],
  });
}

function bodyIndent(text) {
  return new Paragraph({
    style: 'BodyTextIndent',
    spacing: { after: 0 },
    children: [new TextRun({ text: text || '', font: FB, size: 20 })],
  });
}

function bodyTabbed(label, value) {
  return new Paragraph({
    style: 'BodyTextIndent',
    spacing: { after: 0 },
    children: [
      new TextRun({ text: label, font: FB, size: 20 }),
      new TextRun({ text: '\t', font: FB, size: 20 }),
      new TextRun({ text: value, font: FB, size: 20 }),
    ],
  });
}

function sectionHeader(text) {
  return new Paragraph({
    spacing: { before: 240, after: 160 },
    children: [new TextRun({ text, font: FB, size: 20, bold: true })],
  });
}

function feeLinePara(label, amount) {
  return new Paragraph({
    spacing: { before: 120, after: 120 },
    tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB, leader: 'dot' }],
    children: [
      new TextRun({ text: label + ' ', font: FB, size: 20, bold: true }),
      new TextRun({ text: '\t', font: FB, size: 20 }),
      new TextRun({ text: amount, font: FB, size: 20, bold: true }),
    ],
  });
}

function listItem(text) {
  return new Paragraph({
    spacing: { after: 60 },
    indent: { left: 720, hanging: 360 },
    children: [new TextRun({ text: '\u2022\t' + text, font: FB, size: 20 })],
  });
}

function numberedItem(num, text) {
  return new Paragraph({
    spacing: { after: 60 },
    indent: { left: 720, hanging: 360 },
    children: [new TextRun({ text: `${num}.\t${text}`, font: FB, size: 20 })],
  });
}

function emptyPara(after = 160) {
  return new Paragraph({ spacing: { after }, children: [new TextRun({ text: '', font: FB, size: 20 })] });
}

function tcTitle(num, title) {
  return new Paragraph({
    spacing: { before: 120, after: 120, line: 278, lineRule: 'auto' },
    children: [new TextRun({ text: `${num}.\t${title}`, font: FB, size: 16, bold: true })],
  });
}

function tcBody(text) {
  return new Paragraph({
    spacing: { before: 120, after: 0, line: 278, lineRule: 'auto' },
    children: [new TextRun({ text, font: FB, size: 16 })],
  });
}

function tcInitials() {
  return new Paragraph({
    spacing: { before: 120, after: 200 },
    children: [new TextRun({ text: 'Client\u2019s Initials__________', font: FB, size: 16 })],
  });
}

// ─── HEADER INJECTION ────────────────────────────────────────────────────────
// After docx-js builds the zip buffer, we:
// 1. Find which entry names docx-js assigned to header1/header2
// 2. Replace their XML with our canonical anchor XML
// 3. Replace their .rels with correct image relationship
// 4. Add the actual PNG files into word/media/
// This guarantees anchored, right-aligned logos every single time.

function injectHeaders(docxBuffer, logoFullData, logoHdlaData) {
  const zip = new AdmZip(docxBuffer);

  // Find header entry names by inspecting document.xml.rels
  const relsEntry = zip.getEntry('word/_rels/document.xml.rels');
  const relsXml = relsEntry.getData().toString('utf8');

  // Parse out which rId maps to which header file
  // docx-js names them header1.xml (default) and header2.xml (first page)
  // We find by looking for header relationships
  const headerRels = [...relsXml.matchAll(/Id="(rId\d+)"[^>]*Type="[^"]*\/header"[^>]*Target="(header\d+\.xml)"/g)];

  // Determine which is firstPage vs default from the document.xml sectPr
  const docEntry = zip.getEntry('word/document.xml');
  const docXml = docEntry.getData().toString('utf8');

  // docx-js with titlePage:true creates headerReference type="first" and "default"
  // docx-js emits r:id (not w:id) in headerReference elements
  const firstHeaderTarget = (docXml.match(/w:type="first"\s+r:id="(rId\d+)"/) ||
                              docXml.match(/r:id="(rId\d+)"\s[^>]*w:type="first"/))?.[1];
  const defaultHeaderTarget = (docXml.match(/w:type="default"\s+r:id="(rId\d+)"/) ||
                                docXml.match(/r:id="(rId\d+)"\s[^>]*w:type="default"/))?.[1];

  // Map rId -> filename from rels
  const ridToFile = {};
  for (const m of headerRels) {
    ridToFile[m[1]] = m[2];
  }

  const firstHeaderFile = ridToFile[firstHeaderTarget];
  const defaultHeaderFile = ridToFile[defaultHeaderTarget];

  // Replace header XML files with canonical anchor XML
  if (firstHeaderFile) {
    zip.updateFile(`word/${firstHeaderFile}`, Buffer.from(headerXmlFull(), 'utf8'));
    // Replace or add rels for this header
    const relsPath = `word/_rels/${firstHeaderFile}.rels`;
    const relsContent = HEADER_RELS('logo_full.png');
    const existing = zip.getEntry(relsPath);
    if (existing) {
      zip.updateFile(relsPath, Buffer.from(relsContent, 'utf8'));
    } else {
      zip.addFile(relsPath, Buffer.from(relsContent, 'utf8'));
    }
  }

  if (defaultHeaderFile) {
    zip.updateFile(`word/${defaultHeaderFile}`, Buffer.from(headerXmlHdla(), 'utf8'));
    const relsPath = `word/_rels/${defaultHeaderFile}.rels`;
    const relsContent = HEADER_RELS('logo_hdla.png');
    const existing = zip.getEntry(relsPath);
    if (existing) {
      zip.updateFile(relsPath, Buffer.from(relsContent, 'utf8'));
    } else {
      zip.addFile(relsPath, Buffer.from(relsContent, 'utf8'));
    }
  }

  // Add image files to word/media/
  const fullEntry = zip.getEntry('word/media/logo_full.png');
  if (fullEntry) {
    zip.updateFile('word/media/logo_full.png', logoFullData);
  } else {
    zip.addFile('word/media/logo_full.png', logoFullData);
  }

  const hdlaEntry = zip.getEntry('word/media/logo_hdla.png');
  if (hdlaEntry) {
    zip.updateFile('word/media/logo_hdla.png', logoHdlaData);
  } else {
    zip.addFile('word/media/logo_hdla.png', logoHdlaData);
  }

  // Ensure PNG content type is registered in [Content_Types].xml
  const ctEntry = zip.getEntry('[Content_Types].xml');
  let ctXml = ctEntry.getData().toString('utf8');
  if (!ctXml.includes('Extension="png"')) {
    ctXml = ctXml.replace('</Types>', '  <Default Extension="png" ContentType="image/png"/>\n</Types>');
    zip.updateFile('[Content_Types].xml', Buffer.from(ctXml, 'utf8'));
  }

  return zip.toBuffer();
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export async function POST(req) {
  const { error: authError } = await requireCaller(req, LEADERSHIP);
  if (authError) return authError;
  try {
    const { proposal: p } = await req.json();
    if (!p) return NextResponse.json({ error: 'No proposal data' }, { status: 400 });

    const partnerName = PARTNER_NAMES[p.partner] || 'Richie Jones';
    const projectShort = p.projectName || 'HDLA Proposal';
    const dateStr = p.date || new Date().toISOString().split('T')[0];
    const dateFormatted = (() => {
      const d = new Date(dateStr + 'T12:00:00');
      return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    })();

    // Load logos — required. If missing, we still generate but without header images.
    let logoFullData = null, logoHdlaData = null;
    try {
      const pubDir = path.join(process.cwd(), 'public');
      logoFullData = fs.readFileSync(path.join(pubDir, 'logo_full.png'));
      logoHdlaData = fs.readFileSync(path.join(pubDir, 'logo_hdla.png'));
    } catch (e) {
      console.warn('Logo files not found in /public — headers will render as text fallback');
    }

    const children = [];

    // ═══ TITLE ═══
    children.push(new Paragraph({
      spacing: { after: 160 },
      children: [new TextRun({ text: 'PROPOSAL', font: FT, size: 40, bold: true })],
    }));
    children.push(body(p.projectName || ''));
    children.push(body(p.location || '', { after: 160 }));
    children.push(emptyPara(0));

    // ═══ TO / FROM / DATE / RE ═══
    children.push(bodyTabbed('To:', p.clientContact || '[Client Contact Name & Title]'));
    children.push(bodyIndent(p.clientName || ''));
    if (p.clientAddress) {
      p.clientAddress.split('\n').forEach(line => children.push(bodyIndent(line)));
    }
    children.push(emptyPara(0));
    children.push(bodyTabbed('From:', partnerName));
    children.push(bodyIndent('HDLA'));
    children.push(bodyIndent('507 Main Street'));
    children.push(bodyIndent('Nashville, TN 37206'));
    children.push(emptyPara(0));
    children.push(bodyTabbed('Date:', dateFormatted));
    children.push(emptyPara(0));
    children.push(bodyTabbed('RE:', p.reLine || 'Proposal for Landscape Architecture Services'));
    children.push(emptyPara(0));

    // ═══ OPENING ═══
    if (p.openingParagraph) children.push(body(p.openingParagraph));
    if (p.projectUnderstanding) children.push(body(p.projectUnderstanding));
    children.push(body('Please find our outlined scope of work and associated fees below. We have based this proposal on our experience with projects of similar scope and scale and the anticipated time it will take to complete the tasks.'));

    // ═══ SCOPE OF WORK ═══
    children.push(sectionHeader('SCOPE OF WORK'));
    if (p.scopeIntro) children.push(body(p.scopeIntro));

    if (p.exteriorSpaces?.length) {
      children.push(numberedItem(1, 'Landscape and Hardscape for the following exterior spaces:'));
      p.exteriorSpaces.forEach(s => children.push(listItem(s)));
    }

    if (p.hardscapeItems?.length) {
      children.push(body('Hardscape Design includes the following services:', { after: 60 }));
      p.hardscapeItems.forEach(h => children.push(listItem(h)));
    }

    (p.footnotes || []).forEach(f => children.push(body(f)));
    (p.additionalScopeItems || []).forEach((s, i) => children.push(numberedItem(i + 2, s)));
    if (p.adaLanguage) children.push(body(p.adaLanguage));

    // ═══ COMPENSATION ═══
    children.push(sectionHeader('COMPENSATION'));
    if (p.compensationIntro) children.push(body(p.compensationIntro));

    (p.phases || []).forEach(phase => {
      children.push(body(phase.name + ':', { bold: true, before: 160, after: 0 }));
      (phase.description || []).forEach(d => children.push(body(d, { after: 0 })));
      if (phase.deliverables?.length) {
        const delivLabel =
          phase.name.includes('Schematic') ? 'Schematic Design Set with:'
          : phase.name.includes('Design Dev') ? 'Design Development set, including:'
          : phase.name.includes('Construction Doc') ? 'Permit and Construction Document set, including:'
          : phase.name.includes('Construction Admin') ? 'Construction Administration deliverables, including:'
          : 'Deliverables:';
        children.push(body(delivLabel, { after: 0 }));
        phase.deliverables.forEach(d => children.push(listItem(d)));
      }
      children.push(feeLinePara(phase.feeLabel || 'Lump Sum Fee', phase.feeAmount || '$0.00'));
    });

    children.push(emptyPara(0));
    children.push(feeLinePara('Total Fee ', p.totalFee || '$0.00'));
    children.push(emptyPara(0));
    children.push(body(LOCKED.feesRepresent(p.feeYear), { bold: true }));
    children.push(body(LOCKED.reimbursables(p.mileageRate)));
    if (p.holdClause !== false) children.push(body(LOCKED.holdClause));
    children.push(emptyPara(0));
    children.push(body(LOCKED.billedAtCost));
    children.push(body(LOCKED.billingMonthly));

    // ═══ EXCLUSIONS ═══
    children.push(sectionHeader('EXCLUSIONS'));
    children.push(body(LOCKED.exclusionsIntro));
    (p.exclusions || []).forEach(e => children.push(listItem(e)));

    // ═══ ADDITIONAL SERVICES ═══
    children.push(sectionHeader('ADDITIONAL SERVICES'));
    children.push(body(LOCKED.additionalServicesIntro));
    const defaultAdditional = [
      'Artist renderings',
      'Marketing materials',
      'Making revisions in drawings, specifications or other documents once Construction Documents have been completed.',
      'Making revisions in drawings, specifications, or other documents when such revisions are inconsistent with written approvals or instructions previously given; required by the enactment or revisions of codes, laws or regulations subsequent to the preparation of such documents; and/or due to other causes not solely within the control of HDLA.',
      'Providing consultation concerning replacement of any work damaged by vandalism or other causes during construction and furnishing services as may be required in the connection with the replacement of such work.',
      'Providing services made necessary by the default of the Contractor, or by major defects or deficiencies in the work of the Contractor.',
      'Field tagging plants',
      'Additional site visits during Construction Administration',
    ];
    (p.additionalServices || defaultAdditional).forEach(s => children.push(listItem(s)));
    children.push(emptyPara(0));
    children.push(body(LOCKED.fundingWarranty));
    children.push(emptyPara(0));
    children.push(body(LOCKED.tcReference));

    // ═══ TERMINATION ═══
    children.push(sectionHeader('TERMINATION'));
    children.push(body(LOCKED.termination));

    // ═══ CLOSING + SIGNATURES ═══
    children.push(body(LOCKED.closing));
    children.push(emptyPara(200));

    // Signature lines: full-width rule via paragraph bottom border, then HDLA/Date tabbed
    const sigRule = () => new Paragraph({
      spacing: { after: 0 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000', space: 1 } },
      children: [new TextRun({ text: '', font: FB, size: 20 })],
    });
    const sigLabel = (leftText) => new Paragraph({
      spacing: { after: 200 },
      tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB }],
      children: [
        new TextRun({ text: leftText, font: FB, size: 20 }),
        new TextRun({ text: '\t', font: FB, size: 20 }),
        new TextRun({ text: 'Date', font: FB, size: 20 }),
      ],
    });

    children.push(sigRule());
    children.push(sigLabel('HDLA'));
    children.push(emptyPara(0));
    children.push(sigRule());
    children.push(sigLabel(p.clientCompanyName || p.clientName || '[Client Company]'));

    // ═══ FEE CHART (page break) — LOCKED ═══
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(new Paragraph({
      spacing: { before: 240, after: 240 },
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: '2026 HDLA FEE CHART', font: FB, size: 20, bold: true })],
    }));
    FEE_CHART_ROWS.forEach(([role, rate]) => {
      children.push(new Paragraph({
        spacing: { after: 120 },
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: `${role} ${rate}`, font: FB, size: 20 })],
      }));
    });

    // ═══ TERMS AND CONDITIONS (page break) — LOCKED VERBATIM ═══
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(new Paragraph({
      spacing: { before: 240, after: 240, line: 278, lineRule: 'auto' },
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'TERMS AND CONDITIONS', font: FB, size: 20, bold: true })],
    }));
    TC_SECTIONS.forEach(section => {
      children.push(tcTitle(section.num, section.title));
      section.paragraphs.forEach(para => children.push(tcBody(para)));
      if (section.initials) children.push(tcInitials());
    });

    // ═══ BUILD DOCUMENT WITH PLACEHOLDER HEADERS ═══
    // Headers here are plain text placeholders — injectHeaders() will replace them
    // with the correct anchored image XML after docx-js builds the zip.
    const doc = new Document({
      styles: {
        default: { document: { run: { font: FB, size: 20 } } },
        paragraphStyles: [
          {
            id: 'BodyTextIndent',
            name: 'Body Text Indent',
            basedOn: 'Normal',
            run: { font: FB, size: 20, bold: true },
            paragraph: { spacing: { after: 0 }, indent: { left: 720, hanging: 720 } },
          },
        ],
      },
      sections: [{
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 2520, right: 1080, bottom: 1080, left: 1080, header: 1080, footer: 360 },
          },
          titlePage: true,
        },
        headers: {
          // Placeholder paragraphs — replaced by injectHeaders()
          first: new Header({ children: [new Paragraph({ children: [new TextRun({ text: '__HEADER_FIRST__' })] })] }),
          default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: '__HEADER_DEFAULT__' })] })] }),
        },
        footers: {
          first: new Footer({
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [
                new TextRun({ text: '507 Main Street  |  Nashville, TN  |  37206  |  P 615-327-4447  |  www.hodgsondouglas.com  |  Page ', font: FB, size: 18, color: '7F7F7F' }),
                new TextRun({ children: [PageNumber.CURRENT], font: FB, size: 18, color: '7F7F7F' }),
                new TextRun({ text: ' of ', font: FB, size: 18, color: '7F7F7F' }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FB, size: 18, color: '7F7F7F' }),
              ],
            })],
          }),
          default: new Footer({
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [
                new TextRun({ text: `${projectShort}  |  ${dateFormatted}  |  Page `, font: FB, size: 18, color: '7F7F7F' }),
                new TextRun({ children: [PageNumber.CURRENT], font: FB, size: 18, color: '7F7F7F' }),
                new TextRun({ text: ' of ', font: FB, size: 18, color: '7F7F7F' }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FB, size: 18, color: '7F7F7F' }),
              ],
            })],
          }),
        },
        children: children.filter(Boolean),
      }],
    });

    let buffer = await Packer.toBuffer(doc);

    // Inject anchored header images — replaces placeholder header XML in the zip
    if (logoFullData && logoHdlaData) {
      buffer = injectHeaders(buffer, logoFullData, logoHdlaData);
    }

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${(p.projectName || 'HDLA_Proposal').replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_')}_Proposal.docx"`,
      },
    });

  } catch (err) {
    console.error('DOCX generation error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
