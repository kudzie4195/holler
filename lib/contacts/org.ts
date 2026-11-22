/**
 * Is this string the name of an organization (a business, a public office, an institution) and not a private person?
 *
 * Contacts are shown to members and inspection names are printed on public pages, so a private individual's name must never pass.
 * Two rounds of heuristics kept letting a person through, so this is a STRICT SHAPE RULE (round 5, FIX-C). There is no allowance for
 * sole traders any more: "JOHN SMITH ROOFING", "Mary Jones Plumbing LLC" and "MARIA LOPEZ HOME DAYCARE" are rejected.
 *
 * cleanOrgName(name) returns a string only when ALL of these hold for the string it returns:
 *  R1. After accent folding every letter is ASCII (Cyrillic and other look-alike scripts are rejected). No digit, except that one trailing
 *      store number ("#123", " 123") is stripped first.
 *  R2. No token is a listed given name (also inside a hyphenated word or a possessive: "Joe's"), a single letter or a run of initials
 *      ("J", "J.", "P.C.", "L P"), an honorific, a suffix (JR, SR, II, III), a credential (MD, DDS, CPA), a role word (OWNER, ATTN, C/O,
 *      AKA, FBO, ET UX, ET AL, POC, TRUST, ESTATE, HEIRS, RESIDENCE ...) or a job-title word (MANAGER, DIRECTOR, HYGIENIST, PATIENT ...).
 *      Role words anywhere in the value reject the whole value. "REAL ESTATE" is the one exemption: it is a trade, not an estate.
 *  R3. No symbol other than one "&" (or "AND"), apostrophes, hyphens inside one word, and periods in a final legal form ("Inc.").
 *  R4. No street-address shape, phone, email or link shape. A value holding a phone, an email or a link anywhere fails whole.
 *  R5. Positive evidence: a business or trade word that is not a listed given name or surname, a final legal form (LLC, INC, CORP, LTD,
 *      LP, LLP, PLLC; CO, COMPANY, PA, PC, NA only with other evidence), or a public-body word or phrase (CITY OF, COUNTY, DEPARTMENT ...).
 *  R6. Unknown-token budget: words in none of the vocabularies below count as unknown, and so does every listed surname (each part of a
 *      hyphenated word counts on its own, a glued "H&R" counts as one). At most ONE, legal form or not (round 5 FIX-E, review3 P0-2):
 *      "Kowalski Roofing" and "Gallagher LLC" pass, "Danny Smith LLC" and "Okonjo Zelenskyy LLC" fail.
 *  R7. "&"/"AND" joins two sides that are checked together. A glued "X&Y" (1 or 2 letters each side) is allowed only when neither side is
 *      an honorific, a suffix or a given name ("MR&MS", "AL&JO" fail), and it needs R5 evidence like any other name.
 *  R8. Joined strings are split on " - " (and every dash, bullet or invisible character), ";", "|", ":", ",", "\", "/", brackets, quotes,
 *      "@", "%", "*", "~", "=", ">", "<", "+", "^", "?", "!", "_", "...", a period that ends a word of 2+ letters, " DBA " and its variants,
 *      " AT ", " FOR ", " BY ", " WITH ", " VIA ", " FROM ", " OR ", " OBO ", " ON BEHALF OF ", job-title words, and " OF " when the left
 *      side is shaped like a person. A part is returned only when it passes R1 to R7 alone; when another part fails (it may be a person) the
 *      passing part is returned only when it shares no word with any failing part. In "LAST, FIRST" shape the word before the comma counts
 *      as part of the failing part. A job-title word at the very start or end of the value gives null. A part that is only a legal form
 *      stays with the part before it ("Acme Roofing, Inc." -> "Acme Roofing Inc."). Never text from a failing part; when unsure, null.
 *  R9. (FIX-C addition; FIX-E follow-up: a part of a joined value needs two words that are not legal forms) A returned name has at least two words: one word alone is a trade or a place ("ROOFING", "Motel"), not a name.
 *      A given name glued to a surname ("MARIALOPEZ") counts as a given name (R2); a value holding an invisible or direction character
 *      (zero-width space, soft hyphen, BOM, bidi marks) is rejected whole.
 * R10. (FIX-E, review3 P0-1, P1-3, P2-6; list-free) A part fails when
 *      - an unknown word or a listed surname directly follows a word that is known but is not evidence ("Carolina Lopez Daycare",
 *        "Van Tran Roofing", "Main Street Deli"); the place after "<CITY|COUNTY|STATE ...> OF" is exempt ("County of Cook");
 *      - it has two to four words, a known non-evidence word first, and its one unknown word is not next to the evidence or the legal form;
 *      - a word is glued: a mixed-case word with a capital inside ("JSmith", "KeoniKahale", also "McDonald"), a word of 7+ letters that is
 *        not on a vocabulary and starts with a listed given name followed by 3+ more letters ("DANNYSMITH", "JOHNSTON"), or
 *        one or two letters glued to a listed surname of 4+ letters ("JSMITH", "DJSMITH").
 *      GIVEN_NAMES also holds the 5,149 names of given-names-extra.ts and the vocabulary words review3 P0-1 found to be given names
 *      ("candy", "carolina", "van", "son", "thai" ...), so every vocabulary below loses them.
 * "AN" counts as a given name unless the next word starts with a vowel or "h" (the English article: "An Apple Store").
 * The returned string is accent-folded ASCII (FIX-F, review4 P2-10: "Café Brazil Restaurant" -> "Cafe Brazil Restaurant"); a value with an
 * accent is therefore never an exact organisation name. R11 (FIX-F, review4 P1-A, P2-7, P2-9): an unknown word next to a SURNAME_VOCAB
 * word fails; an all-caps unknown word of 5+ letters next to a trade word needs a second vocabulary word; glued names also cover a listed
 * given name + any listed surname and an initial + a listed surname of 3+ letters; joined parts are compared on 4+ letter substrings and
 * keep particles when the failing part is person-shaped.
 * The result is stable (cleanOrgName(cleanOrgName(x)) === cleanOrgName(x)), and isOrganisationName(x) is true only when cleanOrgName(x)
 * equals x after whitespace normalization, so a stored name that still holds anything droppable is rejected on re-check.
 */

import { GIVEN_NAMES_EXTRA } from './given-names-extra';

const MIN_LEN = 3;
const MAX_LEN = 120;

function list(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}

/** Lower case with accents removed ("NUÑEZ" -> "nunez"). */
export function foldName(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036F]/g, '').toLowerCase();
}

// ---- name lists ----------------------------------------------------------------------------------------------------------------------

/**
 * Common US given names: English, Hispanic, Black American, East, Southeast and South Asian, Arabic and Turkish, African, Eastern
 * European, Hebrew and other names seen in US public records. Lower case, accents removed.
 */
const GIVEN_NAMES = new Set(
  list(
    // English and US, male
    'james john robert michael william david richard joseph thomas charles christopher daniel matthew anthony mark donald steven paul ' +
      'andrew joshua kenneth kevin brian george timothy ronald edward jason jeffrey ryan jacob gary nicholas eric jonathan stephen larry ' +
      'justin scott brandon benjamin samuel gregory alexander frank patrick raymond jack dennis jerry tyler aaron henry adam douglas ' +
      'nathan peter zachary kyle walter harold jeremy ethan carl keith roger gerald christian terry sean arthur austin noah lawrence ' +
      'jesse joe bryan billy jordan albert dylan bruce willie gabriel alan juan logan wayne ralph roy eugene randy vincent russell louis ' +
      'philip bobby johnny bradley sam tom tony bob bill jim mike dave steve chris matt dan ben ray fred ted ed al ' +
      'brent trevor cody derek chad dustin shane travis troy todd craig corey cory curtis darren dean drew dwayne earl edwin elijah eli ' +
      'evan floyd francis glenn gordon grant greg howard hunter ian isaac ivan jared jay jeff jerome jimmy joel jon jonah julian kurt ' +
      'lance lee leon leonard lewis lloyd luke marcus marvin martin max melvin micheal miles mitchell neil nelson norman oliver owen ' +
      'perry phillip randall ricky rodney ron ross ruben rudy russ seth shawn sidney spencer stanley stuart taylor terrence theodore tim ' +
      'tommy tracy wade warren wesley calvin chester clarence clifford clyde dale darrell daryl derrick don donnie doug duane eddie ' +
      'elmer ernest everett felix franklin fredrick gene gilbert glen guy harry harvey herbert herman homer hubert jackie jake jamie ' +
      'jeremiah jess jessie joey johnnie kirk lester lonnie luther lyle mack mario marshall maurice michel milton morris nathaniel neal ' +
      'norris oscar otis pete ramon reggie rex rick robbie rocky rodger roland ronnie roosevelt rufus sammy sherman stewart terrance ' +
      'tommie vernon virgil wallace ward wendell wilbur wiley willard willis woodrow zachery bart bartholomew barry benny bert boyd ' +
      'buddy byron carlton cecil chuck cliff conrad dallas damon darin darryl denny desmond dewey dexter dick dominick donovan dudley ' +
      'dwight elbert ellis elton emmanuel ervin forrest garry gerard gilbert grady hal hank harlan hollis irvin irving jasper jerald ' +
      'jody johnathan kelvin ken kent kerry kim kris lamont lane lenny leroy lorenzo lowell lucas lyndon malcolm marc mathew merle ' +
      'monte morgan murray myron ned nick noel norbert orville ozzie percy pierce quentin randolph reuben rob rod rodolfo rory rusty ' +
      'sandy shaun sheldon sonny stan sterling sylvester terrell thad thurman toby tod trent tristan ty tyrone vince wally wilfred ' +
      'winston zack jeffery jerold kenny larry lionel mickey morton nolan rene royce seymour skip stacy stephan teddy wilmer woody ' +
      // modern US, male
      'aiden jayden caden brayden mason liam carter grayson jackson levi wyatt hudson lincoln jaxon asher easton colton cameron connor ' +
      'landon parker cooper chase blake bentley ryder kayden kai maverick brody dominic xavier damian declan elias ezra silas rowan ' +
      'sawyer emmett beau bennett brooks camden colt dawson gage gavin graham hayden holden jace jaden jase jaxson kaden kingston knox ' +
      'lawson legend maddox malachi micah nash paxton reid remington ryker sebastian theo tucker waylon weston zane zion axel bryce ' +
      'caleb colby collin conner dalton devin dillon garrett griffin hayes jett jude kane keegan kellen kendall landen luca matteo ' +
      'miller nico preston quinn reed rhett riley roman rylan tate tobias tripp vance walker wilson king prince major tiger jaxton ' +
      'braxton bryson carson cole colin cruz dakota eli elliot elliott emerson finn gunner harrison jameson jensen jonas kason kyler ' +
      'leo lukas marshall maximus messiah myles oakley orion phoenix porter raymond ronan ryland sullivan talon tanner tyson zander ' +
      // English and US, female
      'mary patricia jennifer linda elizabeth barbara susan jessica sarah karen lisa nancy betty margaret sandra ashley kimberly emily ' +
      'donna michelle carol amanda dorothy melissa deborah stephanie rebecca sharon laura cynthia kathleen amy angela shirley anna ' +
      'brenda pamela emma nicole helen samantha katherine christine debra rachel carolyn janet catherine maria heather diane ruth julie ' +
      'olivia joyce virginia victoria kelly lauren christina joan evelyn judith megan andrea cheryl hannah jacqueline martha gloria ' +
      'teresa ann anne sara madison frances kathryn janice jean abigail alice judy sophia grace denise amber doris marilyn danielle ' +
      'beverly isabella theresa diana natalie brittany charlotte marie kayla alexis lori molly kate jane joy hope faith mia ava ' +
      'erin tiffany crystal wendy stacey paula renee dawn tammy tina tonya tanya vicki vickie connie sherry sheila peggy carla rhonda ' +
      'jill jo joanne jodi kristen kristin kristina krista kara kari katie kathy kelli kellie lacey leah lindsay lindsey lynn lynda ' +
      'lydia mandy marcia marlene melanie meredith misty monica nina norma pam patty penny phyllis priscilla rita robin robyn rosemary ' +
      'roxanne sabrina sally shana shannon shawna shelby shelly sonia stella sue susie sylvia tabitha tamara tara terri toni tricia ' +
      'valerie vanessa vera vivian wanda yvonne april audrey autumn becky bethany bonnie brandi brandy bridget brooke caitlin candace ' +
      'carmen carrie cassandra cathy charlene christy cindy claire colleen courtney dana darlene deanna debbie delores dianne edith ' +
      'eileen elaine eleanor ella ellen elsie erica erika esther ethel eva faye felicia florence gail geraldine gina ginger gwendolyn ' +
      'hazel heidi holly ida irene jana jeanette jeanne jenna jenny jillian josephine juanita june kaitlyn karla katrina kay kendra ' +
      'kerri kristy kristi laurie lena leslie lillian lois loretta lorraine lucille lucy lula mabel marcella margie marian marion ' +
      'marjorie marsha mattie maureen maxine melinda mildred minnie miranda myrtle nellie nora opal pauline pearl rachael ramona regina ' +
      'rosa rose roberta ruby sadie shelley sherri sonya stacie tracey velma veronica viola violet wilma agnes alberta alma alyce ' +
      'annette annie antoinette arlene barb bernadette bernice bertha betsy beulah blanche candice carole cecilia celeste charmaine ' +
      'christie claudia cora daisy della dixie dora dolly doreen effie elena eliza ellie elva emma estelle eunice fannie flora frieda ' +
      'georgia geneva gertrude goldie greta gretchen hattie henrietta hilda imogene inez iris isabel jan janie jeannie jewel jolene ' +
      'kathie katy lana lela leona lila lottie louise luann lupe lynne madeline mae maggie mamie marcy margarita margo maria marla ' +
      'martina maryann maude merle millie mona myra nadine nanette naomi nell olga patsy patti polly rena rhoda roberta rosalie ' +
      'rosalind roslyn sheri sondra stephany sybil tami tess thelma trudy una vernice wilda winifred ' +
      // modern US, female
      'abby addison aubrey avery brianna brooklyn chloe eliana emilia everly gabriella genesis gianna harper hailey ivy jade jasmine ' +
      'kaylee kennedy khloe kinsley layla lily luna madelyn maya mila natalia nevaeh paisley peyton piper reagan savannah scarlett ' +
      'serenity skylar sophie sydney valentina willow zoe aaliyah alexa alyssa amelia aria arianna aurora bella brielle camila caroline ' +
      'delilah emery gracie hadley isla jordyn kaylani kylie leilani londyn lyla mackenzie makayla mckenzie melody nova olive penelope ' +
      'rylee sienna summer ximena zara juno trinity destiny harmony precious haley hayley alexandra allison alexandria amaya anastasia ' +
      'ariana ashlyn bailey brenna briana cadence callie cheyenne ciara daniela emerson esmeralda gabrielle jada jayla jazmin jocelyn ' +
      'kailey kara katelyn kendall kiara kimora kyla leila liliana mallory marissa mariah megan miah mikayla nadia raegan reese sasha ' +
      'selena shayla sierra tatum tessa vivienne whitney yasmin zoey sunny ' +
      // Black American
      'deshawn darnell jamal tyrell lamar andre reginald cedric dewayne latoya keisha tamika shanice ebony imani monique tanisha ' +
      'lakisha darius malik devon dante shaniqua shaquille lashonda latasha latonya tameka tasha keshia kenya ayanna dashawn deandre ' +
      'demetrius dejuan jalen jamar jamari jaquan jermaine javon kareem keon lashawn laquan marquis rashad rasheed shawnte tavon travon ' +
      'trevon tyrese tyrique zaire nia nyla shanika shonda tanesha tierra kenisha lakeisha latrice lawanda octavia shamika tyesha ' +
      'yolanda dominique antoine alphonso cornelius jarvis jerell aisha alisha aniyah deja janae kenyatta latifah marquita nakia ' +
      'quanisha raven shameka sharonda tamia tyra jamil jabari jaylen jaylon kendrick ladarius marquise rashaun tremaine ' +
      // Hispanic
      'jose luis carlos jorge miguel pedro francisco jesus alejandro fernando ricardo roberto javier manuel antonio rafael raul sergio ' +
      'eduardo hector oscar victor diego pablo enrique arturo armando alberto alfredo guillermo gustavo ignacio julio ana guadalupe ' +
      'lucia sofia dolores adriana alicia blanca silvia juana esperanza consuelo graciela araceli xochitl xiomara marisol yesenia ' +
      'beatriz rocio rodrigo santiago mateo emiliano leonardo andres angel adrian cesar valeria mariana fernanda paola lorena maribel ' +
      'marisela yadira yesica catalina estela irma josefina lourdes luz magdalena marta mercedes miriam ofelia pilar reyna rosario ' +
      'soledad susana viviana zoila agustin alonso alvaro benito bernardo cristian efrain elias emilio ernesto esteban eugenio ' +
      'ezequiel federico felipe fidel gerardo gilberto gonzalo heriberto hugo humberto isidro jacinto jaime joaquin leobardo leopoldo ' +
      'marcelo marco mauricio maximiliano moises nestor octavio orlando osvaldo porfirio ramiro reynaldo rigoberto rogelio rolando ' +
      'salvador saul tomas ulises valentin wilfredo abel abraham adan alfonso amado anselmo aurelio baltazar braulio candelario ' +
      'cuauhtemoc dario edgar eliseo fausto feliciano florencio genaro german gregorio homero israel juventino lazaro lino marcos ' +
      'mariano nicolas noe pascual refugio samuel saturnino severiano teodoro tiburcio vicente alejandra concepcion dulce elvira ' +
      'erendira estefania eugenia fabiola felicitas flor hortensia ines isabela itzel jimena karina lidia maricela marisa maritza mayra ' +
      'micaela milagros minerva monserrat nayeli noemi perla raquel rebeca rosalba rosalinda rosaura tania trinidad yazmin zulema ' +
      'ximena yesenia yaritza areli belen brisa citlali dayana jaqueline johana karla leticia lizbeth marina nallely nereida norma ' +
      'odalys reina sonia valeria yolanda ximena anahi arely damaris delfina emilia evangelina griselda iliana ivette jovita julieta ' +
      'leonor mireya nidia olivia paulina rufina socorro yareli ' +
      // Chinese
      'wei li ming hui jian xiao yan jun hong lei mei ling hua qiang yong feng jing xin hao tao bo xiuying xiu yu fang min jie lan ping ' +
      'juan gang hai bin yun tian jia guang ying qing rui shu xia xue yue zhen zhong chun fei gui jin kai lin peng qi shan wen xiang ' +
      'yao zhao zhou chao cheng han kang liang ning shuang song xi yuan dandan haoran jiayi junjie xiaoming xiaoling yiming zihan ' +
      // Korean
      'ji hyun sung young soo eun seung jae hye jung kyung hee joon sang chul woo yeon seo yoon hae sook gyu tae won hoon minjun ' +
      'seoyeon jiwoo jiho yuna jisoo hyunwoo minseo dongho sungmin youngho ' +
      // Japanese
      'hiroshi takashi yuki kenji akira haruto yuto sakura yui kenta takeshi satoshi kazuo hideo yoshiko keiko yoko akiko michiko ' +
      'naoko emi aiko hana haruka kaori mariko megumi miyuki nanami rina sachiko tomoko yumi yuko daichi daisuke hayato hiro ichiro ' +
      'jiro kaito koji makoto masahiro minoru naoki ren riku ryo ryota shota sora taro tatsuya yusuke kenichi noboru shigeru ' +
      // Vietnamese and Southeast Asian
      'thanh minh linh tuan hoa anh duc huong lan phuong quang trung bao binh cuong dung dat giang hang hanh hien hieu hoang hung huy ' +
      'khanh khoa loan mai nga ngoc nhung nhi phong phuc quan quoc quynh tam thao thu thuy tien trang tri truc tuyet uyen viet vinh vy ' +
      'xuan yen bich somchai somsak malee siriporn nattapong kanya arjun ' +
      // South Asian
      'raj ravi priya anil sanjay amit deepak sunil vijay arun krishna rahul pooja neha anita sunita rajesh suresh ramesh mahesh aarav ' +
      'aditya ajay akash amar anand ankit anuj ashok ashish bhavesh chandra darshan dev dinesh ganesh gaurav girish gopal harish hari ' +
      'hemant jagdish jatin karan kartik karthik kiran krish lakshmi manish manoj mohan mukesh naresh naveen nikhil nitin pankaj ' +
      'pradeep prakash pranav prashant praveen rajendra rajiv rakesh rohan rohit sachin sandeep sanjiv santosh satish shankar shiva ' +
      'shyam siddharth subhash sudhir sumit suraj tarun uday varun venkat vikas vikram vinay vinod vishal vivek yash yogesh aarti alka ' +
      'anjali anju archana asha bhavna deepa divya geeta gita hema indira jaya jyoti kajal kamala kavita komal lata leela madhu mala ' +
      'manisha meena meera nandini nisha padma pallavi poonam pratibha preeti radha rani rekha renu ritu sangeeta sapna sarita seema ' +
      'shalini shanti sheela shilpa shobha shreya smita sneha sonal swati uma usha vandana vidya gurpreet harpreet jaspreet manpreet ' +
      'simran amandeep navdeep sukhwinder baljit parminder balwinder kuldeep jasbir ranjit sreeram srinivas venkatesh lakshman ' +
      'murali rajan ramesh sridhar subramanian suresh vasant zubin farhan imtiaz rizwan shahid tanvir nasreen shabnam ' +
      // Arabic and Turkish
      'mohammed muhammad mohammad mohamed ahmed ahmad omar ali fatima hassan hussein ibrahim yusuf khalid mustafa zainab abdullah ' +
      'abdul abdel abdulrahman abdirahman adel adnan amir amin anwar ashraf ayman bilal basim faisal farid farouk fawzi ghassan hamza ' +
      'hamid hani haroun hisham imran ismail jamal karim khaled mahmoud majid mansour marwan mazen nabil nader nasser nizar osama rami ' +
      'rashid riad saad saeed salah salem salim sami samir sharif suleiman tariq walid waleed yasser yasir youssef zaid ziad amina amal ' +
      'asma aya dalia dina farah fatma hala hanan hiba huda iman jamila khadija leila lina maha mariam maryam mona noor nour rana rania ' +
      'reem salma samira sana shadia suha yasmine zahra zeinab abdi ahmet mehmet emre burak cem deniz elif emine fatih hakan kemal ' +
      'murat ozlem serkan tuncay ayse hatice zeynep huseyin osman ' +
      // African
      'oluwaseun olumide ayodele adebayo adewale adeola babatunde bolaji chukwuemeka chinedu chidi chioma chiamaka emeka ebuka ' +
      'ifeanyi ikechukwu kelechi nkechi ngozi obinna ogechi okechukwu uchenna amaka adaeze funmilayo folake femi kunle segun tunde ' +
      'tobi temitope yetunde bisi kehinde taiwo yemi kwame kwabena kofi kojo kwaku kwasi yaw ama akosua abena adwoa efua esi afua yaa ' +
      'thandiwe nomsa sipho thabo themba lerato nandi zanele busisiwe nokuthula mandla sibusiso lungile bongani tshepo kagiso naledi ' +
      'palesa mpho amara abebe abeba alemu almaz tigist tsion selam dawit yohannes tesfaye haile kebede meron abdirizak abdikarim ' +
      'hodan hawa ayan faduma hibo ifrah khadra muna amadou mamadou moussa ibrahima ousmane fatoumata aminata awa aissatou mariama ' +
      'kadiatou seydou boubacar cheikh oumar sekou lamine idrissa jelani kamau kibet wanjiru wanjiku njeri otieno odhiambo achieng ' +
      'akinyi atieno baraka amani zuri beauty blessing comfort gift prosper ' +
      // Eastern European
      'olga ivan dmitri sergei natasha svetlana irina igor vladimir aleksandr aleksei alexei andrei anatoly anton artem boris bogdan ' +
      'dmitry evgeny fyodor gennady grigory ilya konstantin leonid maxim mikhail nikita nikolai oleg pavel petr pyotr ruslan ' +
      'stanislav stepan timur vadim valery viktor vitaly vyacheslav yaroslav yegor yevgeny yuri daria ekaterina galina inna ksenia ' +
      'larisa lyudmila nadezhda oksana polina tatiana tatyana yelena yevgeniya yulia zoya bartosz jakub janusz jerzy jozef kamil ' +
      'krzysztof lukasz marek mariusz michal pawel piotr rafal stanislaw tadeusz tomasz wojciech zbigniew agnieszka beata dorota ewa ' +
      'grazyna halina jadwiga joanna katarzyna krystyna malgorzata monika renata urszula zofia milan miroslav zoran dragan goran ' +
      'nenad dejan bojan vesna snezana jelena milica ivana jiri petra lenka zuzana andras laszlo zoltan istvan gabor attila erzsebet ' +
      'ilona katalin vasile ionut florin mihai andreea ioana mihaela dimitar georgi ivanka borislav taras oleksandr oleksiy volodymyr ' +
      'yuliya mykola halyna nataliya ' +
      // Western European and other
      'siobhan seamus aoife niamh ciaran eoin oisin padraig sinead bjorn sven lars anders ingrid astrid erik nils olaf hans klaus ' +
      'jurgen dieter wolfgang helmut gunter heinz uwe franz karl fritz hilde giuseppe giovanni francesco salvatore vincenzo angelo ' +
      'luigi paolo stefano alessandro giulia francesca chiara alessia giorgia federica pierre jacques philippe francois claude yves ' +
      'luc marcel thierry pascal laurent sylvie nathalie isabelle brigitte chantal juliette amelie celine helene camille manon ' +
      'jean-luc jean-pierre jean-paul marie-claire anne-marie taco joao paulo goncalo ines afonso tiago ' +
      // Hebrew
      'shlomo moshe yosef yaakov avraham yitzhak chaim mordechai menachem ari avi noam yonatan tamar rivka chana shira yael noa ' +
      // Pacific and Native
      'rangi aroha tama mele sione losa tevita keoni kalani leilani makana nalani',
  ),
);

/** Common US surnames (Census), plus surnames that are also business words. */
const SURNAMES = new Set(
  list(
    'smith johnson williams brown jones garcia miller davis rodriguez martinez hernandez lopez gonzalez wilson anderson thomas taylor ' +
      'moore jackson martin lee perez thompson white harris sanchez clark ramirez lewis robinson walker young allen king wright scott ' +
      'torres nguyen hill flores green adams nelson baker hall rivera campbell mitchell carter roberts gomez phillips evans turner diaz ' +
      'parker cruz edwards collins reyes stewart morris morales murphy cook rogers gutierrez ortiz morgan cooper peterson bailey reed ' +
      'kelly howard ramos kim cox ward richardson watson brooks chavez wood james bennett gray mendoza ruiz hughes price alvarez castillo ' +
      'sanders patel myers long ross foster jimenez powell jenkins perry russell sullivan bell coleman butler henderson barnes gonzales ' +
      'fisher vasquez simmons romero jordan patterson alexander hamilton graham reynolds griffin wallace moreno west cole hayes bryant ' +
      'herrera gibson ellis tran medina aguilar stevens murray ford castro marshall owens harrison fernandez mcdonald woods washington ' +
      'kennedy wells vargas henry chen freeman webb tucker guzman burns crawford olson simpson porter hunter gordon mendez silva shaw ' +
      'snyder mason dixon munoz hunt hicks holmes palmer wagner black robertson boyd rose stone salazar fox warren mills meyer rice ' +
      'schmidt garza daniels ferguson nichols stephens soto weaver ryan gardner payne grant dunn kelley spencer hawkins arnold pierce ' +
      'vazquez hansen peters santos hart bradley knight elliott cunningham duncan armstrong hudson carroll lane riley andrews alvarado ' +
      'ray delgado berry perkins hoffman johnston matthews pena richards contreras willis carpenter lawrence sandoval guerrero george ' +
      'chapman rios estrada ortega watkins greene nunez wheeler valdez harper burke larson santiago maldonado morrison franklin carlson ' +
      'austin dominguez carr lawson jacobs obrien lynch singh vega bishop montgomery oliver jensen harvey williamson gilbert dean sims ' +
      'espinoza howell li wong reid hanson le mccoy garrett burton fuller wang weber welch rojas lucas marquez fields park yang little ' +
      'banks padilla day walsh bowman schultz luna fowler mejia davidson acosta brewer may holland juarez newman pearson curtis ' +
      'cortez douglas schneider joseph barrett navarro figueroa keller avila wade molina stanley hopkins campos barnett bates chambers ' +
      'caldwell beck lambert miranda byrd craig ayala lowe frazier powers neal leonard gregory carrillo sutton fleming rhodes shelton ' +
      'schwartz norris jennings watts duran walters cohen mcdaniel moran parks steele vaughn becker holt deleon barker terry hale leon ' +
      'hail benson haynes horton miles lyons pham graves bush thornton wolfe warner cabrera mckinney mann zimmerman dawson lara fletcher ' +
      'page mccarthy love robles cervantes solis erickson reeves chang klein salinas fuentes baldwin daniel simon velasquez hardy higgins ' +
      'aguirre lin cummings chandler sharp barber bowen ochoa dennis robbins liu ramsey francis griffith paul blair oconnor cardenas ' +
      'pacheco cross calderon quinn moss swanson chan rivas khan rodgers serrano fitzgerald rosales stevenson christensen manning gill ' +
      'curry mclaughlin harmon mcgee gross doyle garner newton burgess reese walton blake trujillo adkins brady goodman roman webster ' +
      'goodwin fischer huang potter delacruz montoya todd wu hines mullins castaneda malone cannon tate mack sherman hubbard hodges zhang ' +
      'guerra wolf valencia saunders franco rowe gallagher farmer hammond hampton townsend ingram wise gallegos clarke barton schroeder ' +
      'maxwell waters logan camacho strickland norman person colon parsons frank harrington glover osborne buchanan casey floyd ' +
      'patton ibarra ball tyler suarez bowers orozco salas cobb gibbs andrade bauer conner moody escobar mcguire lloyd mueller hartman ' +
      'french kramer mcbride pope lindsey velazquez norton mccormick sparks flynn yates hogan marsh macias villanueva zamora pratt ' +
      'stokes owen ballard lang brock villarreal charles drake barrera cain patrick pineda burnett mercado santana shepherd bautista ali ' +
      'shaffer lamb trevino mckenzie hess beil olsen cochran morton nash wilkins petersen briggs shah roth nicholson holloway lozano ' +
      'flowers rangel hoover arias short mora valenzuela bryan meyers weiss underwood bass greer summers houston carson morrow clayton ' +
      'whitaker decker yoder collier zuniga carey wilcox melendez poole roberson larsen conley davenport copeland massey lam huff rocha ' +
      'cameron jefferson hood monroe anthony pittman huynh randall singleton kirk combs mathis christian skinner bradford richard galvan ' +
      'wall boone kirby wilkinson bridges bruce atkinson velez meza roy vincent york hodge villa abbott allison tapia gates chase sosa ' +
      'sweeney farrell wyatt dalton horn barron phelps yu dickerson heath foley atkins mathews bonilla acevedo benitez zavala hensley ' +
      'glenn cisneros harrell shields rubio choi huffman boyer garrison arroyo bond kane hancock callahan dillon cline wiggins grimes ' +
      'arellano melton oneill savage ho beltran pitts parrish ponce rich booth koch golden ware brennan mcdowell marks cantu humphrey ' +
      'baxter sawyer clay tanner hutchinson kaur berg wiley gilmore russo villegas hobbs keith wilkerson ahmed beard mcclain montes mata ' +
      'rosario vang walter henson oneal mosley mcclure beasley stephenson snow huerta preston vance barry johns eaton blackwell dyer ' +
      'prince macdonald solomon guevara stafford english hurst woodard cortes shannon kemp nolan mccullough merritt murillo moon salgado ' +
      'strong kline cordova barajas roach rosas winters jacobson lester knox bullock kerr leach meadows orr davila whitehead pruitt kent ' +
      'conway mckee barr david dejesus marin berger mcintyre blankenship gaines palacios cuevas bartlett durham dorsey mccall odonnell ' +
      'stein browning stout lowery sloan mclean hendricks calhoun sexton chung gentry hull duarte ellison nielsen gillespie buck middleton ' +
      'sellers leblanc esparza hardin bradshaw mcintosh howe livingston frost glass morse knapp herman stark bravo noble spears weeks ' +
      'corona frederick buckley mcfarland hebert enriquez hickman quintero randolph schaefer walls trejo house reilly pennington michael ' +
      'conrad giles benjamin crosby fitzpatrick donovan mays mahoney valentine raymond medrano hahn mcmillan small bentley felix peck ' +
      'lucero boyle hanna pace rush hurley harding mcconnell bernal nava ayers everett ventura avery pugh mayer bender shepard mcmahon ' +
      'landry case sampson moses magana blackburn dunlap gould duffy vaughan herring mckay espinosa rivers farley bernard ashley friedman ' +
      'potts truong costa correa blevins nixon clements fry delarosa best benton lugo portillo dougherty crane haley phan villalobos ' +
      'blanchard horne finley quintana lynn esquivel bean dodson mullen xiong hayden cano levy huber richmond moyer lim frye sheppard ' +
      'mccarty avalos booker waller parra woodward jaramillo krueger rasmussen brandt peralta donaldson stuart faulkner maynard galindo ' +
      'coffey estes sanford burch maddox vo oconnell vu andersen spence mcpherson church schmitt stanton leal cherry compton dudley ' +
      'sierra pollard alfaro hester proctor lu hinton novak good madden mccann terrell jarvis dickson reyna cantrell mayo branch hendrix ' +
      'rollins rowland whitney duke odom daugherty travis tang archer painter kitchen temple vanwagner whitfield rossi ' +
      // more surnames seen in US records, including names of other origins
      'kowalski nowak wojcik kowalczyk lewandowski zielinski szymanski wozniak ostrowski kozlowski jankowski mazur krawczyk wisniewski ' +
      'ivanov ivanova petrov smirnov kuznetsov kuznetsova popov sokolov volkov novikov morozov shevchenko kovalenko bondarenko ' +
      'tkachenko oliynyk horvath nagy toth szabo kovacs popescu ionescu dimitrov georgiev okafor okonkwo adeyemi okeke eze nwosu ' +
      'obi mensah boateng owusu asante diallo traore keita toure ndiaye mohamud warsame hussein abdi haile tesfaye kebede mahlangu ' +
      'dlamini nkosi khumalo ndlovu mokoena sithole tanaka suzuki watanabe takahashi yamamoto nakamura kobayashi sato ito kato ' +
      'yoshida yamada sasaki inoue kimura shimizu hayashi saito park choi jung kang cho yoon jang lim han shin seo kwon hwang ahn ' +
      'song jeon hong oh nguyen tran pham hoang phan vu vo dang bui do ho ngo duong ly chen zhou xu sun ma zhu hu guo he gao luo zheng ' +
      'liang xie tang feng deng cao peng zeng xiao tian dong pan yuan cai jiang yu du ye cheng wei su lu ding ren shen yao lu jiang ' +
      'cui zhong tan kumar sharma gupta reddy rao iyer nair menon pillai mehta shah joshi desai chopra kapoor malhotra verma yadav ' +
      'mishra pandey tiwari chaudhary banerjee chatterjee mukherjee das bose ghosh sen dutta krishnan subramanian venkatesh ' +
      'hassan hussain rahman islam chowdhury ahmed qureshi siddiqui ansari sheikh malik akhtar butt mirza haddad khoury nassar saleh ' +
      'mansour aziz karim abdullah yilmaz kaya demir sahin celik ozturk aydin arslan dogan rossi russo ferrari esposito bianchi ' +
      'romano colombo ricci marino greco bruno gallo conti deluca costa giordano mancini rizzo lombardi moretti muller schmidt ' +
      'schneider fischer weber meyer wagner becker schulz hoffmann koch richter klein wolf schroder neumann schwarz zimmermann ' +
      'braun kruger hofmann hartmann lange schmitt werner krause meier lehmann dubois durand lefebvre moreau laurent girard ' +
      'bonnet dupont lambert fontaine rousseau vincent morel fournier o\'brien o\'neil o\'malley mcallister vanderbilt abernathy ' +
      'featherstone lindqvist abramowitz hargrove okonkwo delacroix nowak sorcar hartley wren jackson grant lombardi hayes polo rossi ' +
      'winthrop cabot lodge heyworth sharma sreeram ockerse refaeli quispe mamani sigurdsson tuilagi jeong ngata shevchenko ' +
      'kuznetsova wojciechowski diallo te whare warsame ' +
      // surnames that are also business or trade words: a lone one is never evidence of a business
      'burger burgers coffee arena brothers union council beauty montessori wines solar taco deli salon bureau pizza baptist buffet ' +
      'diner fence league school coop hardware gallery sisters bar inn grill market mart store garage service college lodge parish ' +
      'studio law bank chapel kitchen temple church tavern spa shack hall mills fields field wood woods stone hill hills banks bridges ' +
      'house castle tower towers park parks rivers lake lakes forest grove dale vale marsh moor pond ford brook brooks well wells ' +
      'mason carpenter painter baker cook butcher fisher farmer gardener weaver taylor tailor potter smith miller cooper turner ' +
      'glazier plumber roofer slater thatcher sawyer chandler brewer barber draper fuller tanner dyer hunter carter archer bowman ' +
      'steward chamberlain marshall sheriff bishop abbot dean deacon pope cardinal king prince duke earl lord baron knight squire ' +
      'major sargent constable judge mayor alderman',
  ),
);

/** Name-list edits from the second privacy review (review2.md P0-1 item 6): business words that are real surnames or given names. */
for (const w of list('center centers cooling gas nails office hospital tours pools wings silver beach quick garden shore place corner point maine driver nurse clerk officer')) {
  SURNAMES.add(w);
}
for (const w of list(
  'river denver star royal blue mercy liberty legacy meadow canyon shiloh magnolia lotus cedar ridge memphis bronx montana nevada florida ' +
    'america tennessee saint sunshine rainbow urban bay texas happy lucky',
)) {
  GIVEN_NAMES.add(w);
}
/** Given names the review's strings use that the lists above missed (round 5 FIX-C). "an" is handled in givenAt (English article). */
for (const w of list(
  'an lou dewi spas walt',
)) {
  GIVEN_NAMES.add(w);
}
/** Round 5 FIX-F (review4 P1-A "Red Cotton Trucking"): "red" is a given name (nickname) as well as a color word. */
GIVEN_NAMES.add('red');
/** Round 5 FIX-E: the 5,149 US birth-record names the lists missed (review3 P0-2) and the vocabulary words that are given names (P0-1). */
for (const w of list(GIVEN_NAMES_EXTRA)) GIVEN_NAMES.add(w);
for (const w of list(
  'candy carolina christi cleveland marietta princess queen ivory van son thai diamond emerald coral sky unique raleigh columbus cicero ' +
    'roswell arlington tex velvet windy bethel blossom china oral marine les del',
)) {
  GIVEN_NAMES.add(w);
}

// ---- vocabularies --------------------------------------------------------------------------------------------------------------------
// Every vocabulary below is filtered against both name lists, so a list edit can never turn a name into evidence or a known word.

const notName = (w: string): boolean => !GIVEN_NAMES.has(w) && !SURNAMES.has(w);
const vocab = (s: string): Set<string> => new Set(list(s).filter(notName));

/** Final legal forms that are evidence on their own and raise the unknown budget to two. */
const LEGAL_STRONG = new Set(list('llc l.l.c inc incorporated corp corporation ltd limited lp llp l.l.p lllp l.l.l.p pllc p.l.l.c plc pbc'));
/** Final legal forms that count only with other evidence (also initials or credentials). They never raise the budget. */
const LEGAL_WEAK = new Set(list('co company pa pc na'));

/** Business, trade and institution words: evidence (R5a). */
const BUSINESS = vocab(
  // forms of organization
  'group groups holdings partners partnership associates associated enterprises enterprise services solutions systems industries ' +
    'international global ventures investments capital properties property realty management development developers developments ' +
    'consulting consultants corporate firm firms agency agencies association assn society foundation institute coalition alliance ' +
    'cooperative co-op coop federation commission committee ministries ministry fellowship congregation business businesses ' +
    'trading imports exports importers distributors distributor distribution distributing logistics manufacturing manufacturers ' +
    'technologies technology tech labs lab laboratory laboratories networks network communications media marketing advertising ' +
    'productions publishing publishers printing printers graphics staffing recruiting payroll accounting bookkeeping tax taxes ' +
    'legal attorneys lawyers notary insurance underwriters brokerage brokers lending loans mortgage mortgages bancorp banking ' +
    'bancshares credit savings financial finance wealth advisors advisory equity fund funds exchange pawn ' +
    // trades and building
    'contractors contracting contractor construction constructors builders builder building buildings remodeling remodelers ' +
    'renovations renovation restoration restorations roofing roofers plumbing electric electrical electricians mechanical hvac heating ' +
    'refrigeration ventilation insulation drywall painting painters carpentry masonry concrete paving pavers excavating excavation ' +
    'demolition wrecking landscaping landscape landscapes landscapers lawncare lawn lawns irrigation fencing fences glazing siding ' +
    'gutters gutter windows doors flooring floors tile tiles cabinets cabinetry countertops granite elevator elevators energy ' +
    'utilities welding fabrication fabricators steelworks ironworks sheetmetal metals steel signs signage awning awnings pools spas ' +
    'pest exterminating exterminators termite janitorial cleaning cleaners maintenance hauling towing movers moving storage ' +
    'engineering engineers architects architecture architectural design designs surveying surveyors inspections abatement ' +
    'environmental supply supplies equipment rentals rental lumber plumbers mechanics automation installations installers ' +
    'waterproofing foundations sprinkler sprinklers septic drilling grading trucking freight transport transportation repair repairs ' +
    'conditioning air-conditioning plastering stucco drywalls asphalt sealcoating striping excavators sitework demo junk disposal ' +
    'dumpster dumpsters recycling salvage scrap locksmith locksmiths security alarm alarms surveillance solar renewables ' +
    'remodel handyman restoration mold radon chimney chimneys fireplace fireplaces garage-doors overhead doorworks millwork woodworks ' +
    'carpets carpet rugs blinds shutters draperies upholstery interiors decor framing glassworks mirrors ' +
    // food and drink
    'restaurant restaurants cafe cafeteria grille bistro brasserie trattoria ristorante osteria enoteca creperie eatery eateries ' +
    'pizzeria pizzas taqueria tacos cantina sushi ramen pho noodle noodles bakery bakeries bakeshop pastry pastries patisserie ' +
    'donuts doughnuts espresso roasters roastery teahouse juice juices smoothie smoothies creamery gelato delicatessen catering ' +
    'caterers steakhouse chophouse smokehouse seafood oyster oysters crawfish bbq barbecue chicken pub pubs saloon lounge brewery ' +
    'breweries brewing brewpub winery wineries vineyard vineyards distillery distilleries spirits liquor liquors foods food cuisine ' +
    'taproom bagels bagel panaderia pasteleria tortilleria carniceria pupuseria marisqueria birrieria paleteria neveria fruteria ' +
    'dulceria cevicheria dumpling dumplings hibachi teriyaki bakehouse confectionery chocolates chocolatier icecream yogurt ' +
    'burritos tamales empanadas arepas pupusas gyros kabob kabobs kebab kebabs shawarma falafel curry tandoori biryani pasta subs ' +
    'sandwiches sandwich hotdogs cupcakes cakes cookies desserts sweets candy candies snacks frozen boba beverages beverage ' +
    'groceries grocery provisions meats poultry produce farms dairy creameries orchard orchards cellars cider ciders concessions ' +
    'vending commissary foodservice hamburgers ' +
    // shops and services
    'markets supermarket supermarkets superstore hypermarket minimart stores shop shoppe shops boutique boutiques outlet outlets ' +
    'pharmacy pharmacies drugstore apothecary salons barbershop barbershops barbers cosmetics fitness gym gyms laundromat laundry ' +
    'dry-cleaners motors automotive auto autos autobody tire tires collision dealership dealerships dealers wheels transmission ' +
    'muffler mufflers lube carwash detailing hotel hotels motel motels suites resort resorts hostel apartments condominiums condos ' +
    'townhomes lofts theater theatre theaters cinema cinemas studios museum museums club clubs stadium florist florists ' +
    'flowers floral jewelers jewelry diamonds optical opticians furniture mattress mattresses bedding appliances appliance electronics ' +
    'wireless cellular travel tours petroleum fuel fuels propane depot wholesale wholesalers retail retailers warehouse warehouses ' +
    'supercenter pawnshop thrift consignment antiques collectibles hobbies toys games gaming books bookstore bookstores music ' +
    'instruments pianos guitars photography photo photos video videos films entertainment events banquet banquets ballroom venue ' +
    'venues nightclub karaoke billiards bowling arcade yoga pilates crossfit karate taekwondo jiujitsu martial dance athletics ' +
    'sports golf tennis aquatics swim marina boats marine cycles bikes bicycles scooters tools machine machining machinery parts ' +
    'printing tailoring alterations uniforms linens textiles fabrics apparel clothing fashion fashions shoes footwear eyewear ' +
    'tattoo tattoos piercing vapor vape smoke tobacco cigars hookah kennel kennels boarding grooming pets pet petco veterinary vet ' +
    'animal animals daycare childcare preschool preschools kindergarten nursery nurseries greenhouse greenhouses ' +
    // health, education, faith
    'dental dentistry dentists orthodontics orthodontic endodontics periodontics oral clinic clinics hospitals medical medicine ' +
    'healthcare health wellness pediatrics pediatric surgical surgery surgeons orthopedic orthopedics dermatology cardiology oncology ' +
    'radiology imaging diagnostics urgent chiropractic optometry eyecare audiology hearing therapy therapies rehabilitation rehab ' +
    'counseling psychiatry psychology behavioral pharmaceuticals hospice nursing homecare assisted eldercare caregivers ' +
    'academy academies schools elementary preparatory prep learning education educational tutoring university universities ' +
    'institute institutes seminary colleges campus churches cathedral mosque masjid synagogue tabernacle sanctuary diocese ' +
    'archdiocese methodist lutheran catholic presbyterian episcopal pentecostal evangelical apostolic adventist nazarene missionary ' +
    'iglesia templo ministerios parroquia ' +
    // "estate" passes the role check only inside "real estate"
    'salad salads soup soups care washing wash sign erectors title real estate bros',
);

/** Public-body words: evidence (R5c). */
const PUBLIC = vocab(
  'county counties district districts department departments dept authority authorities government governments municipal ' +
    'municipality township borough administration commission commissioners board boards bureau agency agencies division ' +
    'offices council court courts police sheriff sheriffs fire-rescue library libraries transit housing utilities utility sewer ' +
    'sanitation recreation public federal university universities colleges purchasing procurement contracting acquisition ' +
    'acquisitions army navy airforce corps guard marines veterans affairs services',
);

/**
 * Words that are not names and are not evidence: descriptive words, places, colors, numbers, directions, common adjectives and nouns.
 * Known, so they do not count against the unknown budget (R6).
 */
const KNOWN = vocab(
  'the of in on to el la las los le les del de da des du di dos das lo ' +
    // industry words that are not evidence alone
    'flood control industrial facility facilities companies whole dry china seoul tokyo saigon hanoi manila bangkok delhi bombay ' +
    'havana lima bogota oaxaca jalisco michoacan puebla guanajuato acapulco cancun northwestern southwestern memorial holiday ' +
    'bread hot cold quick-service drive-in drive-thru carry-out takeout sweet treats crescent leaf hometown northside southside eastside ' +
    'westside evergreen clear pressure redwood self review unified boys girls peking greater upper lower inner outer ' +
    // words of federal award descriptions (USAspending), so an ordinary description is not read as a person
    'grass cutting mowing removal snow trash waste debris svcs svc install provide providing furnish support project projects phase ' +
    'base bases facility contract contracts task order orders annual monthly quarterly option options year years period performance ' +
    'preventive emergency routine custodial grounds replacement replace upgrade upgrades site sites work works various multiple ' +
    'new existing interior exterior roof roofs hvac boiler boilers chiller chillers generator generators parking lot lots ' +
    'collection pickup recurring requirements requirement indefinite delivery quantity idiq bpa blanket purchase agreement ' +
    'labor materials material system systems program programs operation operations ' +
    'fort camp naval joint force forces reserve installation installations depot arsenal barracks ' +
    // directions and geography
    'north south east west northern southern eastern western central northeast northwest southeast southwest midwest midwestern ' +
    'pacific atlantic coastal coast gulf mountain mountains valley valleys creek creeks lake lakes harbor harbour springs mesa ' +
    'desert prairie meadows forest grove oak oaks pine pines cedars maple elm cypress palm palms lakeview lakeside lakeshore ' +
    'riverside riverview hillside hilltop parkside parkview bayside oceanside seaside downtown uptown midtown metro metropolitan ' +
    'rural suburban national nationwide american americas united regional local community neighborhood family families ' +
    'plaza square port landing crossing station junction island islands view vista home homes village town city tri state ' +
    'statewide states county-wide citywide area areas side way ways line lines link hub works zone spot stop gate gates heights ' +
    'falls hollow terrace trail trails road roads street streets avenue main circle parkway highway hwy route ' +
    // cuisines and peoples
    'thai chinese mexican italian japanese korean indian vietnamese greek cuban peruvian salvadoran colombian filipino ethiopian ' +
    'lebanese turkish persian halal kosher soul cajun creole tex mex lone windy dragon panda bamboo tropical caribbean asian latin ' +
    'latino hispanic african european universal world worldwide discount dollar value budget economy christian bible gospel ' +
    'faithful zion calvary bethel emmanuel mount mt french german spanish irish british english polish russian brazilian ' +
    'jamaican haitian nigerian somali mediterranean oriental nordic' +
    ' ' +
    // places (state and city names that are not on a name list)
    'alabama alaska arizona arkansas california colorado connecticut delaware hawaii idaho illinois iowa kansas kentucky louisiana ' +
    'maryland massachusetts michigan minnesota mississippi missouri nebraska hampshire jersey mexico york ohio oklahoma oregon ' +
    'pennsylvania rhode utah vermont wisconsin wyoming carolina dakota chicago atlanta seattle boston miami orlando tampa nashville ' +
    'detroit queens manhattan harlem brooklyn staten peachtree midway oakland pasadena sacramento tucson portland philadelphia ' +
    'pittsburgh baltimore cleveland cincinnati columbus milwaukee minneapolis omaha tulsa albuquerque honolulu anchorage ' +
    'raleigh durham richmond norfolk jacksonville louisville lexington knoxville chattanooga birmingham ' +
    'mobile shreveport baton rouge orleans galveston corpus christi laredo waco plano irving arlington ' +
    'buckhead marietta decatur smyrna alpharetta roswell dunwoody evanston skokie cicero naperville joliet ' +
    'usa us ' +
    // colors, metals, numbers
    'red orange yellow green purple black white gray grey gold golden crimson azure emerald sapphire pink teal indigo copper bronze ' +
    'platinum one two three four five six seven eight nine ten eleven twelve twenty hundred thousand million first second ' +
    'third fourth fifth sixth seventh eighth ninth tenth ' +
    // common adjectives
    'new old big little small tiny giant mega super ultra pro best better good great grand fine fresh quality premier prime ' +
    'premium elite select superior supreme ultimate deluxe precision allied advanced affordable reliable trusted certified licensed ' +
    'master top quick fast express rapid modern classic vintage antique imperial regal sacred holy eternal divine heavenly ' +
    'bright clean green safe sure smart easy simple pure natural organic healthy cozy friendly honest true loyal ' +
    'perfect pristine sparkling shiny brilliant creative custom total complete general standard special unique original ' +
    'authentic famous original genuine local global metro united independent integrated innovative dynamic strategic ' +
    'professional skilled expert efficient affordable economy discount wild rustic coastal tropical warm cool cold ' +
    'hot cozy little tiny mighty rapid instant direct quickly ' +
    // common nouns
    'star stars sun sunrise sunset moon sky skyline horizon ocean sea wave waves wind winds rain snow ice fire flame flames ' +
    'water waters earth land lands rock rocks peak peaks summit crown eagle eagles hawk falcon lion lions ' +
    'bear bears horse horses bull bulls buffalo dragon pioneer pioneers frontier heritage victory freedom ' +
    'eagle anchor arrow compass keystone cornerstone milestone landmark gateway pathway palace kingdom ' +
    'empire legend legends dream dreams vision visions spirit soul heart hearts hand hands touch smile smiles care caring kids ' +
    'children child babies baby tots tykes toddlers youth teens families people neighbors friends sons daughters son ' +
    'partners associates team crew squad club nation world planet universe galaxy table plate bowl spoon fork cup cups ' +
    'pot pan oven flame hearth gardens tree trees leaf leaves flower blossom bloom tulip orchid ' +
    'spice spices honey sugar butter cream milk bread breads rice bean beans corn ' +
    'lemon lime mango coconut peach peaches apple apples berry berries grape grapes fig' +
    ' ' +
    'shine sparkle glow wash scrub sweep brush paint brick bricks woodland timber iron metal ' +
    'silk cotton velvet lace ivory diamond diamonds onyx coral ' +
    'smile shape body mind life living lifestyle style styles image images look looks glamour glam lux luxe ' +
    'luxury chic posh elegance elegant classy trendy hair hairs lashes brows skin ' +
    'queen queens princess crown empire ' +
    'auto car cars truck trucks van vans bus buses taxi cab limo limousine jet air aero aviation ' +
    'homes housing manor courtyard villa villas cabin cabins cottage cottages ranch farm ' +
    'barn factory works plant plants yard yards dock docks pier port harbor ' +
    'pointe centre centres square plaza commons mall malls galleria arcade row ' +
    'avenue boulevard parkway alley path paths bend bends ' +
    'net web online digital cyber data cloud mobile ' +
    'plus pro express xpress depot spot stop hub hq',
);

/** Public-body phrases (R5c): the first word followed by "of". */
const PUBLIC_PHRASE_HEADS = new Set(list('city town village county state commonwealth port borough township district parish people'));

const HONORIFICS = new Set(
  list(
    'mr mrs ms miss mx mister missus dr doctor rev reverend fr father pastor hon honorable sir dame madam madame prof professor capt ' +
      'captain cpt sgt sergeant lt lieutenant col colonel maj cmdr bishop elder deacon brother sister sra srta senor senora sra dona ' +
      'mr&mrs mrs&mr mr&ms ms&mr dr&mrs dr&ms',
  ),
);
const SUFFIXES = new Set(list('jr sr ii iii iv vi vii viii junior 2nd 3rd 4th'));
const CREDENTIALS = new Set(
  list('md dds dmd phd psyd esq cpa rn np aprn lpn lcsw lmft lpc dvm pharmd jd mba aia fnp crnp cna lmt dpt slp pac leed ap'),
);
/** Job-title and status words (R2). They also split a value (R8): "JOHN SMITH PRESIDENT SMITH ROOFING INC". */
const TITLE_WORDS = new Set(
  list(
    'president vice vp ceo cfo coo cto rep representative manager mgr agent principal secretary treasurer supervisor ' +
      'superintendent supt foreman director chairman chairwoman chairperson chair hygienist patient guest clerk officer nurse student ' +
      'apprentice volunteer worker laborer salesman saleswoman salesperson helper customer provider vendor employee member qualifier ' +
      'licensee permittee registrant proprietor prop inspector technician assistant asst aide teacher counselor therapist physician ' +
      'pharmacist receptionist bookkeeper estimator journeyman chef caller requestor requester complainant neighbor renter buyer seller ' +
      'engineer architect designer consultant attorney lawyer counsel broker realtor administrator admin coordinator specialist ' +
      'operator installer electrician plumber roofer mechanic chief partner associate pic contact holder signer signatory applicant ' +
      'officer occupant resident tenant spouse wife husband widow widower',
  ),
);
/** Words that join a person to a company (R8). */
const CONNECTOR_SEPARATORS = list('at for by with via from or vs versus nee obo');
/** Street suffix abbreviations: a value ending in one is an address, not a name (R4). */
const STREET_ABBR = new Set(list('st ave av rd blvd ln dr ct hwy pkwy cir ter trl pl sq expy fwy'));
/** Street suffixes (full and abbreviated) for the address shape. */
export const STREET_SUFFIX_WORDS = new Set(
  list(
    'st street ave av avenue rd road blvd boulevard dr drive ln lane ct court way pl place hwy highway pkwy parkway cir circle ter ' +
      'terrace trl trail sq square loop pike plz plaza expy expressway fwy freeway row run xing crossing cv cove pt point aly alley',
  ),
);

/** Person roles, estates and personal trusts anywhere in the value (R2). "real estate" is removed before this is tested. */
const ROLE_RE =
  /\b(?:home\s?owners?|owners?|tenants?|occupants?|applicants?|residents?|landlords?|lessee|lessor|c\/o|care of|in care of|attn|attention|aka|a\/k\/a|a\.k\.a|fbo|f\/b\/o|for the benefit of|et\.?\s?ux|et\.?\s?al|et\.?\s?vir|etux|etal|poc|point of contact|trusts?|trustees?|ttees?|tr|trs|estates?|est|heirs?|custodian|cust|guardian|gdn|conservator|executor|executrix|poa|power of attorney|beneficiar(?:y|ies)|deceased|dec'?d|household|residence|minor|jtwros|jt ten|ten com|tod|pod|ira|utma|ugma|h\/w|survivorship|successor|personal representative)\b/i;

// ---- shapes --------------------------------------------------------------------------------------------------------------------------

const EMAIL_RE = /[\w.+'-]+@[\w-]+(?:\.[\w-]+)+/;
/** 10 digits in any common layout (also "/", "_" and spaces), or 7 digits with "-" or "."; glued to letters or an extension still matches. */
const PHONE_RE = /(?<!\d)(?:\+?1[\s./_-]?)?\(?\d{3}\)?[\s./_-]*\d{3}[\s./_-]*\d{4}(?!\d)|(?<![\d-])\d{3}[-.]\d{4}(?!\d)/;
const URL_RE = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9][a-z0-9-]*\.(?:com|net|org|gov|edu|mil|us|io|biz|info|app|dev|ai|me|tv)\b/i;
/** A house number followed within four words by a street suffix (R4). */
const ADDRESS_SHAPE_RE = new RegExp(
  `\\b\\d{1,6}[a-z]?\\s+(?:\\S+\\s+){0,3}(?:${[...STREET_SUFFIX_WORDS].join('|')})\\b`,
  'i',
);

/** A phone, an email or a link anywhere in the text. */
export function hasContactShape(text: string): boolean {
  return typeof text === 'string' && (EMAIL_RE.test(text) || PHONE_RE.test(text) || URL_RE.test(text));
}
/** A house number followed within four words by a street suffix ("JOHN SMITH 123 CENTER ST"). */
export function hasStreetAddressShape(text: string): boolean {
  return typeof text === 'string' && ADDRESS_SHAPE_RE.test(text);
}
/** A person role word anywhere ("c/o", "attn", "owner", "trust", "estate" ...); "real estate" does not count. */
export function hasRoleWord(text: string): boolean {
  return typeof text === 'string' && ROLE_RE.test(foldName(text).replace(/\breal\s+estate\b/g, ' '));
}

// ---- tokens --------------------------------------------------------------------------------------------------------------------------

type Kind =
  | 'conj'
  | 'glued'
  | 'given'
  | 'initial'
  | 'honor'
  | 'suffix'
  | 'cred'
  | 'title'
  | 'legalStrong'
  | 'legalWeak'
  | 'business'
  | 'public'
  | 'known'
  | 'surname'
  | 'unknown'
  | 'bad';

interface Tok {
  raw: string;
  /** Folded lower case, curly apostrophes made straight. */
  k: string;
  kind: Kind;
  /** Unknown words this token adds to the budget (R6). */
  unknown: number;
  /** Words to compare across parts (R8): the word, its hyphen pieces and its possessive base. */
  words: string[];
}

const VOWEL_START = /^[aeiouh]/;

function isGiven(w: string): boolean {
  return GIVEN_NAMES.has(w) || GIVEN_NAMES.has(w.replace(/'/g, ''));
}
function isSurname(w: string): boolean {
  return SURNAMES.has(w) || SURNAMES.has(w.replace(/'/g, ''));
}
function possessiveBase(w: string): string | null {
  const m = w.match(/^(.+?)(?:'s|s')$/);
  return m && m[1].length >= 2 ? m[1] : null;
}

/** Shortest given name that counts as the start of a glued word (R10). */
const GLUED_GIVEN_MIN = 2;

/**
 * A name written as one word (R2, R10): a listed given name glued to a listed surname or given name, or the other way round
 * ("MARIALOPEZ", "JOHNSMITH", "LOPEZMARIA"), each part of three or more letters; a word of 7+ letters that starts with a listed given
 * name of 3+ letters followed by 3+ more letters ("DANNYKOWALSKI", "JOHNSTON"); or one or two letters glued to a listed surname of 4+
 * letters ("JSMITH", "DJSMITH"). Words on a vocabulary or legal forms are never split.
 */
function gluedName(w: string): boolean {
  if (w.length < 4 || BUSINESS.has(w) || PUBLIC.has(w) || KNOWN.has(w) || LEGAL_STRONG.has(w) || LEGAL_WEAK.has(w)) return false;
  for (let i = 3; i <= w.length - 3; i++) {
    const a = w.slice(0, i);
    const b = w.slice(i);
    if ((GIVEN_NAMES.has(a) && (SURNAMES.has(b) || GIVEN_NAMES.has(b))) || (SURNAMES.has(a) && GIVEN_NAMES.has(b))) return true;
  }
  if (w.length >= 7) {
    for (let i = GLUED_GIVEN_MIN; i <= w.length - 3; i++) if (GIVEN_NAMES.has(w.slice(0, i))) return true;
  }
  // review4 P2-7: a listed given name glued to a listed surname of any length ("LISAWU", "MOLLYTO").
  for (let i = 2; i <= w.length - 2; i++) if (GIVEN_NAMES.has(w.slice(0, i)) && SURNAMES.has(w.slice(i))) return true;
  for (const i of [1, 2]) {
    const rest = w.slice(i);
    if (rest.length >= 3 && SURNAMES.has(rest)) return true; // review4 P2-7: "JLEE" (was 4+)
  }
  // review4 P2-7: any 3+ letters glued in front of a listed surname of 4+ letters ("SUONGTORRES", "KATSUMINGUYEN").
  if (w.length >= 7) for (let i = 3; i <= w.length - 4; i++) if (SURNAMES.has(w.slice(i))) return true;
  return false;
}

/** A mixed-case word with a capital after its first letter, per hyphen or apostrophe piece ("JSmith", "KeoniKahale", "McDonald"). */
function innerCapital(raw: string): boolean {
  return raw.split(/[-'\u2019]/).some((p) => /[a-z]/.test(p) && /^.+[A-Z]/.test(p));
}

/** One plain word (no dots, no hyphen). `next` is the following word, for the English article "an". */
function wordKind(w: string, isFinal: boolean, next: string | undefined): Kind {
  if (!/^[a-z][a-z'-]*$/.test(w)) return 'bad';
  const base = possessiveBase(w);
  if (base) {
    if (isGiven(base)) return 'given';
    const bk = wordKind(base, false, undefined);
    return bk === 'legalStrong' || bk === 'legalWeak' ? 'unknown' : bk;
  }
  const plain = w.replace(/'/g, '');
  if (plain.length === 1) return 'initial';
  if (plain === 'an') return next && VOWEL_START.test(next) ? 'known' : 'given';
  if (isGiven(w) || gluedName(plain)) return 'given';
  if (HONORIFICS.has(plain)) return 'honor';
  if (SUFFIXES.has(plain)) return 'suffix';
  if (CREDENTIALS.has(plain)) return 'cred';
  if (TITLE_WORDS.has(plain)) return 'title';
  if (LEGAL_STRONG.has(plain)) return isFinal ? 'legalStrong' : 'unknown';
  if (LEGAL_WEAK.has(plain)) return isFinal ? 'legalWeak' : 'unknown';
  if (isSurname(w)) return 'surname';
  if (BUSINESS.has(plain)) return 'business';
  if (PUBLIC.has(plain)) return 'public';
  if (KNOWN.has(plain)) return 'known';
  return 'unknown';
}

const FAIL_KINDS = new Set<Kind>(['given', 'initial', 'honor', 'suffix', 'cred', 'title', 'bad']);

function makeTok(raw: string, isFinal: boolean, nextRaw: string | undefined): Tok {
  const k = foldName(raw).replace(/[\u2018\u2019`\u00B4]/g, "'");
  const next = nextRaw ? foldName(nextRaw) : undefined;
  const words = k
    .replace(/'s$|s'$/, '')
    .split(/[^a-z']+/)
    .map((x) => x.replace(/'/g, ''))
    .filter(Boolean);
  words.push(k.replace(/[^a-z]/g, ''));
  const tok = (kind: Kind, unknown = 0): Tok => ({ raw, k, kind, unknown, words: [...new Set(words)].filter(Boolean) });

  if (k === '&' || k === 'and') return tok('conj');
  if (innerCapital(raw)) return tok('given'); // R10: a glued name written in mixed case
  if (k.includes('&')) {
    const m = k.match(/^([a-z]{1,2})&([a-z]{1,2})$/);
    if (!m) return tok('bad');
    const sideBad = (x: string) => HONORIFICS.has(x) || SUFFIXES.has(x) || isGiven(x);
    return sideBad(m[1]) || sideBad(m[2]) ? tok('given') : tok('glued', 1);
  }
  if (k.includes('.')) {
    const dotless = k.replace(/\.$/, '');
    if (/^(?:[a-z]\.)+[a-z]?\.?$/.test(k)) {
      // Dotted letters: a final "L.L.C." or "P.L.L.C." is a legal form; any two-letter run ("P.C.", "L.P.", "J.R.") is initials.
      if (isFinal && dotless.replace(/\./g, '').length >= 3 && LEGAL_STRONG.has(dotless)) return tok('legalStrong');
      return tok('initial');
    }
    if (!/^[a-z][a-z'-]*\.$/.test(k)) return tok('bad'); // a period inside a word
    const w = k.slice(0, -1);
    if (isFinal && LEGAL_STRONG.has(w)) return tok('legalStrong');
    if (isFinal && LEGAL_WEAK.has(w)) return tok('legalWeak');
    const kind = wordKind(w, false, next);
    // Only an honorific or a suffix may carry a period (they fail anyway); anywhere else a period is a symbol (R3).
    return kind === 'honor' || kind === 'suffix' || kind === 'initial' || kind === 'given' ? tok(kind) : tok('bad');
  }
  if (k.includes('-')) {
    if (/^-|-$|--/.test(k)) return tok('bad');
    const whole = wordKind(k, isFinal, next);
    if (whole !== 'unknown' && whole !== 'bad') return tok(whole, whole === 'surname' ? 1 : 0);
    let unknown = 0;
    let evidence: Kind | null = null;
    for (const p of k.split('-')) {
      const pk = wordKind(p, false, undefined);
      if (FAIL_KINDS.has(pk)) return tok(pk);
      if (pk === 'unknown' || pk === 'surname' || pk === 'legalStrong' || pk === 'legalWeak') unknown++;
      else if (pk === 'business' || pk === 'public') evidence = pk;
    }
    if (evidence && unknown === 0) return tok(evidence);
    // A hyphenated word with an unknown part is not evidence; each unknown part counts (R6).
    return tok(unknown ? 'unknown' : 'known', unknown);
  }
  const kind = wordKind(k, isFinal, next);
  return tok(kind, kind === 'unknown' || kind === 'surname' ? 1 : 0);
}

function tokenize(text: string): Tok[] {
  const raws = text.split(/\s+/).filter(Boolean);
  return raws.map((r, i) => makeTok(r, i === raws.length - 1, raws[i + 1]));
}

// ---- one part (no separators left) ---------------------------------------------------------------------------------------------------

const EDGE_PUNCT = /^[\s"'`.,;:\-*_|/\\]+|[\s"'`,;:\-*_|/\\]+$/g;
const EDGE_WORDS = new Set(['of', 'for', 'at', 'by', 'with', 'via', 'from', 'and', '&', 'to', 'in', 'on', 'or']);
const STORE_NUMBER_RE = /(?:\s*#\s*\d{1,6}|\s+\d{1,6})$/;

/** Strip edge punctuation, connector words at the edges and a trailing period that is not part of a legal form. */
function tidyPart(text: string): string {
  let t = text.replace(EDGE_PUNCT, '').trim();
  for (;;) {
    const ws = t.split(/\s+/).filter(Boolean);
    if (ws.length && EDGE_WORDS.has(foldName(ws[0]))) t = ws.slice(1).join(' ');
    else if (ws.length && EDGE_WORDS.has(foldName(ws[ws.length - 1]))) t = ws.slice(0, -1).join(' ');
    else break;
    t = t.replace(EDGE_PUNCT, '').trim();
  }
  if (/\.$/.test(t)) {
    const last = foldName(t.split(/\s+/).pop() ?? '').replace(/\.$/, '');
    const keep = LEGAL_STRONG.has(last) || LEGAL_WEAK.has(last) || /^(?:[a-z]\.)+[a-z]$/.test(last);
    if (!keep) t = t.replace(/\.+$/, '').trim();
  }
  return t;
}

interface PartResult {
  /** The cleaned part, or null when it fails. */
  out: string | null;
  toks: Tok[];
}

/** R1 to R7 on one part. */
function evaluatePart(text: string): PartResult {
  let t = text.replace(/\s+/g, ' ').trim();
  t = t.replace(STORE_NUMBER_RE, '').trim();
  t = tidyPart(t);
  const toks = tokenize(t);
  const fail: PartResult = { out: null, toks };
  if (!t || /\d/.test(t)) return fail; // R1: no digit left after one trailing store number
  if (/[^A-Za-z\u00C0-\u024F\s&'.\-]/.test(t)) return fail; // R3
  if (/[^\x00-\x7f]/.test(foldName(t))) return fail; // R1
  if (!toks.length || toks.some((x) => FAIL_KINDS.has(x.kind))) return fail; // R2, R3
  const conj = toks.filter((x) => x.kind === 'conj' || x.kind === 'glued').length;
  if (conj > 1) return fail; // R3: a single "&" or "AND"
  if (toks[0].kind === 'conj' || toks[toks.length - 1].kind === 'conj') return fail;
  const last = toks[toks.length - 1];
  if (STREET_ABBR.has(last.k.replace(/\.$/, ''))) return fail; // R4
  const strongLegal = last.kind === 'legalStrong';
  // One word alone is a trade or a place ("ROOFING", "Motel"), never a name to show: at least two words (when unsure, null).
  if (toks.length < 2) return fail;
  const unknown = toks.reduce((n, x) => n + x.unknown, 0);
  const word = toks.some((x) => x.kind === 'business' || x.kind === 'public');
  const phrase = toks.some((x, i) => PUBLIC_PHRASE_HEADS.has(x.k) && toks[i + 1]?.k === 'of' && i + 2 < toks.length);
  const evidence = word || phrase || strongLegal; // R5; a weak legal form only with other evidence
  if (!evidence) return fail;
  if (unknown > 1) return fail; // R6: one unknown word, legal form or not
  if (!r10Ok(toks)) return fail; // R10
  const out = toks.map((x) => x.raw).join(' ');
  if (out.length < MIN_LEN || out.length > MAX_LEN) return fail;
  return { out, toks };
}

const EVIDENCE_KINDS = new Set<Kind>(['business', 'public', 'legalStrong', 'legalWeak']);

/**
 * Round 5 FIX-F (review4 P1-A): vocabulary words that are also US surnames with 500 or more bearers (Census 2000 surname file, 254 words,
 * rebuilt from the review's /tmp/rev4/vocab-surnames-all.txt). An unknown word directly next to one of them is a person's name shape
 * ("Thiago Lima LLC", "Kwesi Bright LLC", "Barnaby Steel"), so the part fails.
 */
export const SURNAME_VOCAB: ReadonlySet<string> = new Set(
  list(
    'bright cotton camp sweet bowling smart bloom self hand link land north street rock gold flood hawk boston lemon lo ' +
    'alley way cloud lima main east grey new fine falcon mesa bull south teal mount hair wild peak eagle true fort bear ' +
    'falls southern staten irish oaks to apple nation palm steel corn brush pine holiday styles dollar birmingham shine ' +
    'plant real lux wash cool la neighbors child plaza via sites fast bible peach lower grass valley roof maple music ' +
    'woodland look orange harbour force ice crew board work vineyard flower springs trail creek six northern rhode copper ' +
    'thrift mountain lines corpus line manor brick dry leaf works spoon cutting million nee port divine silk honey dance ' +
    'western states court wind row pink crown victory dragon town orchard grand master pier super clear baltimore standard ' +
    'sons red body streets mango games pines mall grounds yard swim colorado first greek dock courts tennis guard lone ' +
    'homes lands plate hampshire sugar puebla prime imperial hands azure furnish books smoke oakland latino dunwoody junk ' +
    'el square beverage regal harbor in metro beans commons heart touch marines on heritage old peaks pho plants trees ' +
    'demo greenhouse elm eagles de lion oak norfolk los schools kennel decatur nine rain sea island spice oregon purchase ' +
    'redwood lawn buffalo holy care prairie rocks cypress boys latin laredo base pickup general credit grapes fresh oyster ' +
    'bears labor circle life albuquerque summit bulls tree roads pro butter russian naval route car palms people iglesia ' +
    'from smiles jersey loyal condos gutter salvage state drilling',
  ).filter((w) => !GIVEN_NAMES.has(w)), // "red" is a listed given name (FIX-F), so it is a name, not a vocabulary word
);

/** R10, the list-free rule: no unknown word right after a known non-evidence word, and a lone unknown word next to the evidence. */
function r10Ok(toks: Tok[]): boolean {
  // review4 P1-A: an unknown word next to a vocabulary word that is also a common surname.
  const sv = (x: Tok | undefined) => Boolean(x && SURNAME_VOCAB.has(x.k.replace(/'s$/, '').replace(/\.$/, '')));
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].unknown === 0) continue;
    if (sv(toks[i - 1]) || sv(toks[i + 1])) return false;
  }
  // review4 P2-7: an all-caps unknown word of 5+ letters next to a trade word needs a second vocabulary word that is not a legal form
  // ("KNOWICKI ROOFING", "KOWALSKI ROOFING LLC" fail; "LAKEFRONT ROOFING & SIDING INC" passes).
  const vocabCount = toks.filter((x) => x.kind === 'business' || x.kind === 'public' || x.kind === 'known').length;
  for (let i = 0; i < toks.length; i++) {
    const x = toks[i];
    if (x.unknown === 0 || !/^[A-Z][A-Z'-]{4,}$/.test(x.raw)) continue;
    if ((toks[i - 1]?.kind === 'business' || toks[i + 1]?.kind === 'business') && vocabCount < 2) return false;
  }
  for (let i = 1; i < toks.length; i++) {
    if (toks[i].unknown === 0 || toks[i - 1].kind !== 'known') continue;
    // "County of Cook", "City of Lakewood": the place after a public-body phrase is not a person's surname.
    if (toks[i - 1].k === 'of' && i >= 2 && PUBLIC_PHRASE_HEADS.has(toks[i - 2].k)) continue;
    return false;
  }
  const unknownAt = toks.map((x, i) => (x.unknown > 0 ? i : -1)).filter((i) => i >= 0);
  if (toks.length >= 2 && toks.length <= 4 && unknownAt.length === 1 && toks[0].kind === 'known') {
    const i = unknownAt[0];
    if (![toks[i - 1], toks[i + 1]].some((x) => x && EVIDENCE_KINDS.has(x.kind))) return false;
  }
  return true;
}

// ---- splitting (R8) ------------------------------------------------------------------------------------------------------------------

const SYM = '\u0001';
const COMMA = '\u0002';
const WORD = '\u0003';
const TITLE = '\u0004';
const MARKERS = /([\u0001-\u0004])/;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

const DBA_FORMS = [
  'd/b/a', 'd.b.a.', 'd.b.a', 'd b a', 'dba:', 'dba-', 'dba', 't/a', 'trading as', 'doing business as', 'operating as', 'o/a', 'f/k/a',
  'fka', 'n/k/a', 'nka', 'formerly', 'formerly known as', 'w/', 'on behalf of', 'and/or', 'successor to', 'in care of', 'license holder',
  'licence holder', 'lic holder', 'works for', 'employed by', 'working for',
];
const DBA_RE = new RegExp(`(^|\\s)(?:${DBA_FORMS.sort((a, b) => b.length - a.length).map(escapeRe).join('|')})(?=\\s|$)`, 'gi');
const CONNECTOR_RE = new RegExp(`(^|\\s)(?:${CONNECTOR_SEPARATORS.join('|')})(?=\\s|$)`, 'gi');
const TITLE_RE = new RegExp(`(^|\\s)(?:${[...TITLE_WORDS].join('|')})\\.?(?=\\s|$)`, 'gi');

/** Unicode normalization and the separator characters every source uses. */
function normalize(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u00AD]/g, ' | ') // invisible characters
    .replace(/[\u0000-\u001f\u007f]/g, ' | ') // tabs, newlines and other controls
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/[\u2010-\u2015\u2212\u2E3A\u2E3B\uFE58\uFE63\uFF0D]/g, ' - ') // every dash, tight or spaced
    .replace(/[\u00B7\u2022\u2023\u2027\u2043\u2219\u22C5\u30FB\u25CF\u25E6\u2026\u00A6\u2016]/g, ' | ') // bullets, dots, ellipsis
    .replace(/[\u201C\u201D\u201E\u201F\u00AB\u00BB\u2039\u203A]/g, '"')
    .replace(/[\u2018\u2019\u201B\u00B4]/g, "'");
}

interface Part {
  text: string;
  /** Marker before this part ('' for the first). */
  before: string;
}

function splitParts(s: string): Part[] | null {
  let t = s;
  t = t.replace(DBA_RE, `$1${WORD}`);
  t = t.replace(CONNECTOR_RE, `$1${WORD}`);
  t = t.replace(TITLE_RE, `$1${TITLE}`);
  t = t.replace(/\.{2,}/g, SYM);
  // A period that ends a word of two or more letters (not an honorific or a suffix) splits: "BRENT KOWALSKI. APEX ROOFING LLC".
  t = t.replace(/([A-Za-z'-]+)\.(?=\s)/g, (m, w: string) => {
    const piece = foldName(w.split('-').pop() ?? '');
    return piece.length >= 2 && !HONORIFICS.has(piece) && !SUFFIXES.has(piece) ? `${w}${SYM}` : m;
  });
  t = t.replace(/,/g, COMMA);
  t = t.replace(/\s+-+\s*|\s*-+\s+|--+/g, SYM); // a hyphen with a space on either side, or a double hyphen
  t = t.replace(/[;|\\/:()[\]{}"@%*~=<>+^?!_$\u00A6]/g, SYM);
  t = t.replace(/#(?!\s*\d)/g, SYM);
  t = t.replace(/(^|\s)'(?=\s|$)/g, `$1${SYM}`);
  const pieces = t.split(MARKERS);
  const parts: Part[] = [];
  let before = '';
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    if (i % 2 === 1) {
      // Keep the strongest marker seen since the last text: a title word, then a word separator, then a comma, then a symbol.
      const rank = (m: string) => [SYM, COMMA, WORD, TITLE].indexOf(m);
      if (!before || rank(p) > rank(before)) before = p;
      continue;
    }
    if (!p.trim()) continue;
    parts.push({ text: p, before });
    before = '';
  }
  // A job-title word at the very start or the very end: "PRESIDENT JOHN SMITH", "JOHN SMITH OFFICE MANAGER" (R8).
  const textAt = pieces.map((p, i) => (i % 2 === 0 && p.trim() ? i : -1)).filter((i) => i >= 0);
  if (!textAt.length) return [];
  if (pieces.slice(0, textAt[0]).includes(TITLE) || pieces.slice(textAt[textAt.length - 1] + 1).includes(TITLE)) return null;
  return parts;
}

/** A person-shaped run of words: names, initials or unknown words only, at most four, with a name word, an initial or two words. */
const PARTICLES = new Set(list('de del la las los le da di du dos das van von der den ter el bin ibn mc mac st'));

function personShaped(toks: Tok[]): boolean {
  const core = toks.filter((x) => !['honor', 'suffix', 'cred', 'conj'].includes(x.kind) && !PARTICLES.has(x.k));
  if (!core.length || core.length > 4) return false;
  if (core.some((x) => !['given', 'surname', 'unknown', 'initial'].includes(x.kind))) return false;
  return core.some((x) => x.kind === 'given' || x.kind === 'surname' || x.kind === 'initial') || core.length >= 2;
}

/** "JOHN SMITH OF SMITH ROOFING": split on " OF " when the words before it are shaped like a person. */
function splitOnPersonOf(parts: Part[]): Part[] {
  const out: Part[] = [];
  for (const p of parts) {
    const ws = p.text.trim().split(/\s+/);
    const i = ws.findIndex((w, j) => j > 0 && j < ws.length - 1 && foldName(w) === 'of');
    if (i > 0 && personShaped(tokenize(ws.slice(0, i).join(' ')))) {
      out.push({ text: ws.slice(0, i).join(' '), before: p.before });
      out.push({ text: ws.slice(i + 1).join(' '), before: WORD });
    } else out.push(p);
  }
  return out;
}

function isLegalOnly(text: string): boolean {
  const ws = tidyPart(text).split(/\s+/).filter(Boolean);
  return (
    ws.length > 0 &&
    ws.every((w) => {
      const k = foldName(w).replace(/\.$/, '');
      return LEGAL_STRONG.has(k) || LEGAL_WEAK.has(k);
    })
  );
}

const IGNORED_SHARED = new Set(['the', 'of', 'and', 'in', 'on', 'to', 'at', 'for', 'by', 'de', 'la', 'el', 'del', 'los', 'las']);
const PARTICLE_SHARED = new Set(['la', 'el', 'de', 'los', 'las', 'del']);

/** review4 P2-9: a word of a passing part that is inside a failing word, or the other way round, on 4+ letters ("JohnnyRamey" / "Ramey"). */
function sharesSubstring(word: string, failing: Set<string>): boolean {
  for (const f of failing) {
    if (word.length >= 4 && f.includes(word)) return true;
    if (f.length >= 4 && word.includes(f)) return true;
  }
  return false;
}

function cleanParts(s: string): string | null {
  let parts = splitParts(s);
  if (!parts) return null;
  parts = splitOnPersonOf(parts);
  // A part that is only a legal form stays with the part before it ("Acme Roofing, Inc." -> "Acme Roofing Inc.").
  const merged: Part[] = [];
  for (const p of parts) {
    if (merged.length && isLegalOnly(p.text) && p.before !== WORD && p.before !== TITLE) {
      merged[merged.length - 1] = { ...merged[merged.length - 1], text: `${tidyPart(merged[merged.length - 1].text)} ${tidyPart(p.text)}` };
    } else merged.push(p);
  }
  const results = merged.map((p) => evaluatePart(p.text));
  const failingWords = new Set<string>();
  results.forEach((r, i) => {
    if (r.out !== null) return;
    // review4 P2-9: particles ("la", "el", "de" ...) count when the failing part is shaped like a person ("Rosa La = La Landscaping").
    const keepParticles = personShaped(r.toks);
    for (const x of r.toks) for (const w of x.words) if (!IGNORED_SHARED.has(w) || (keepParticles && PARTICLE_SHARED.has(w))) failingWords.add(w);
    // "Summit Mechanical KOWALSKI, BRENT T": in LAST, FIRST shape the word before the separator belongs to the person.
    const first = r.toks.find((x) => !['honor'].includes(x.kind));
    if (i > 0 && merged[i].before === COMMA && first && ['given', 'initial'].includes(first.kind)) {
      const prev = results[i - 1].toks[results[i - 1].toks.length - 1];
      if (prev && (prev.kind === 'unknown' || prev.kind === 'surname' || prev.kind === 'given')) for (const w of prev.words) failingWords.add(w);
    }
  });
  for (const r of results) {
    if (r.out === null) continue;
    if (r.toks.some((x) => x.words.some((w) => failingWords.has(w) || sharesSubstring(w, failingWords)))) continue;
    // FIX-E follow-up: a part taken out of a joined value is never a fragment: two or more words that are not legal forms
    // ("Smith Heating/Cooling LLC" gives null, not "Cooling LLC"; "APEX LLC D/B/A <person>" gives null).
    if (merged.length > 1 && r.toks.filter((x) => !['legalStrong', 'legalWeak', 'conj'].includes(x.kind)).length < 2) continue;
    return r.out;
  }
  return null;
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * The organization name as it may be stored or printed (the part of a joined value that passes, a trailing store number stripped, edge
 * punctuation and quotes removed), or null when the string is not clearly an organization under the strict shape rule above. Stable.
 */
export function cleanOrgName(name: string): string | null {
  if (typeof name !== 'string') return null;
  if (!name.trim() || name.length > 400) return null;
  // Invisible and direction characters can split a word in two ("MARIA LO<U+200B>PEZ"): the value is not trusted at all.
  if (/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u00AD]/.test(name)) return null;
  // R1 on the letters as written: after accent folding every letter is a-z. Fullwidth, Cyrillic, Greek, ligature and other compatibility
  // letters ("\uFF2A", "\u0430", "\u01C7") are rejected before any normalization could turn them into ASCII.
  if (/\p{L}/u.test(foldName(name).replace(/[a-z]/g, ''))) return null;
  const s = normalize(name);
  if (hasContactShape(s)) return null; // R4: a phone, an email or a link anywhere
  if (/[^\x00-\x7f]/.test(foldName(s))) return null; // R1: Cyrillic and other look-alike letters
  if (hasRoleWord(s)) return null; // R2: role words anywhere
  const out = cleanParts(s);
  if (!out) return null;
  const t = collapse(out);
  if (t.length < MIN_LEN || t.length > MAX_LEN) return null;
  if (hasStreetAddressShape(t)) return null; // R4
  // review4 P2-10: the returned name is accent-folded ASCII ("Café" -> "Cafe"); case is kept.
  return t.normalize('NFD').replace(/[\u0300-\u036F]/g, '');
}

/** True only when cleanOrgName returns the same string (after whitespace normalization): nothing in it is droppable. */
export function isOrganisationName(name: string): boolean {
  if (typeof name !== 'string') return false;
  const c = cleanOrgName(name);
  return c !== null && c === collapse(name);
}

// ---- person-shape helpers (public text guards) ---------------------------------------------------------------------------------------

function wordsOf(text: string): string[] {
  return normalize(text)
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .split(/[\s,;|/\\:]+/)
    .map((w) => w.replace(/^[^A-Za-z\u00C0-\u024F&]+|[^A-Za-z\u00C0-\u024F.']+$/g, ''))
    .filter((w) => w && !/\d/.test(w));
}

function tokensOf(text: string): Tok[] {
  const ws = wordsOf(text);
  return ws.map((w, i) => makeTok(w.replace(/\.$/, ''), false, ws[i + 1]));
}

/**
 * Does this text read like a private person's name (ids and honorifics ignored)? "JOHN SMITH", "SMITH, JOHN A", "BRENT KOWALSKI #4521",
 * "ZENDAYA OKONJO" (two words on no vocabulary). A single unknown word ("ACME") is not.
 */
export function looksLikePersonName(text: string): boolean {
  if (typeof text !== 'string') return false;
  return personShaped(tokensOf(text));
}

/** A full personal name: person-shaped AND holding a given name or an initial ("JOHN SMITH", "SMITH, J"). "FORT HOOD" is not. */
export function looksLikeFullPersonName(text: string): boolean {
  if (typeof text !== 'string') return false;
  const toks = tokensOf(text);
  return personShaped(toks) && toks.some((x) => x.kind === 'given' || x.kind === 'initial');
}

/** A person's name, a listed given name, or initials next to a word anywhere in the text. */
export function mentionsPersonName(text: string): boolean {
  if (typeof text !== 'string') return false;
  const toks = tokensOf(text);
  return personShaped(toks) || toks.some((x) => x.kind === 'given') || (toks.some((x) => x.kind === 'initial') && toks.length > 1);
}

/** Any listed given name in the text (accents folded, hyphen parts and possessives too; "an" only when it is not the article). */
export function holdsGivenName(text: string): boolean {
  if (typeof text !== 'string') return false;
  const ws = normalize(text).split(/[^A-Za-z\u00C0-\u024F'&-]+/).filter(Boolean);
  return ws.some((w, i) => {
    const k = foldName(w).replace(/[\u2018\u2019]/g, "'");
    const pieces = k.split(/[-&]/).filter(Boolean);
    return pieces.some((p) => {
      const base = possessiveBase(p) ?? p;
      if (base === 'an') return !(ws[i + 1] && VOWEL_START.test(foldName(ws[i + 1])));
      return isGiven(base);
    });
  });
}

/** A listed given name followed by another word ("JOHN SMITH", "SAINT PAUL"); words in `allowAfter` do not count. */
export function givenNameThenWord(text: string, allowAfter: (w: string) => boolean = () => false): boolean {
  if (typeof text !== 'string') return false;
  const ws = normalize(text).split(/\s+/).map((w) => foldName(w).replace(/[^a-z'-]/g, '')).filter(Boolean);
  return ws.some((w, i) => i < ws.length - 1 && (isGiven(w) || (w === 'an' && !VOWEL_START.test(ws[i + 1]))) && !allowAfter(ws[i + 1]));
}

/** Words inside public-body names that are also surnames or plain words ("Office", "School District", "Independent"). */
const PUBLIC_NAME_WORDS = new Set(list('office school schools independent unified consolidated of the'));

/** A word that names a public body or office (county, department, office, board ...), for buyer names. */
export function isPublicBodyWord(w: string): boolean {
  const k = foldName(w);
  return PUBLIC.has(k) || PUBLIC_PHRASE_HEADS.has(k) || PUBLIC_NAME_WORDS.has(k);
}

/** Words on no vocabulary, listed surnames and listed given names, counted (public text guards and buyer names). */
export function countUnknownWords(text: string): number {
  return tokensOf(text).filter((x) => ['unknown', 'surname', 'given'].includes(x.kind)).length;
}

/** Is this one word a listed given name (accents folded, apostrophes ignored)? For vocabularies built elsewhere (sanitize.ts places). */
export function isListedGivenName(w: string): boolean {
  return isGiven(foldName(w).replace(/[\u2018\u2019`]/g, "'"));
}

/** Plain-word classification for other guards: is this word on a non-name vocabulary (business, public, descriptive)? */
export function isVocabularyWord(w: string): boolean {
  const k = foldName(w);
  return notName(k) && (BUSINESS.has(k) || PUBLIC.has(k) || KNOWN.has(k));
}

// ---- structured company fields ---------------------------------------------------------------------------------------------------------

/**
 * Words that make a registered name a company name (a legal form, or a word that only a business carries). One of them is REQUIRED by
 * registeredCompanyName. Role words (owner, manager, tenant, agent, trust, estate) are never in this list.
 */
const COMPANY_MARKERS = new Set(
  list(
    'llc l.l.c inc inc. incorporated corp corp. corporation co co. company ltd limited lp l.p. llp lllp lllc pllc hdfc ' +
      'management managment mgmt mgt realty properties property associates holdings holding group partners equities enterprises ' +
      'development housing apartments residential capital services investments ventures builders construction brokerage',
  ),
);
/** Extra person-role and placeholder shapes for structured fields (hasRoleWord already covers owner, tenant, trust, estate, c/o ...). */
const STRUCTURED_ROLE_RE =
  /\b(?:agents?|managers?|supers?|superintendents?|lessees?|lessors?|landlords?|occupants?|residents?|self[- ]managed|owner[- ]occupied|same as|see above|as above|n\/?a|none|unknown|individual|tbd|various|multiple)\b/i;

/** Ordinal street numbers ("32ND", "5th"): digits plus a suffix, never read as a digit-for-letter disguise. */
const ORDINAL_RE = /^\d+(?:st|nd|rd|th)$/i;
/** Honorifics: a registered company name that starts with or holds one names a person ("DR. PATEL MANAGEMENT INC"). */
const COMPANY_NAME_HONORIFICS = new Set(['dr', 'mr', 'mrs', 'ms', 'mx', 'miss', 'rev', 'prof']);
const DIGIT_FOR_LETTER: Record<string, string> = { '0': 'O', '1': 'I', '3': 'E', '4': 'A', '5': 'S' };
/** A word as the name check reads it: punctuation off, and digit-for-letter disguises undone inside words that mix letters and digits ("J0HN" -> "JOHN"). */
function nameFormOf(w: string): string {
  const bare = w.replace(/[^A-Za-z0-9'-]/g, '').replace(/^['-]+|['-]+$/g, '');
  if (!/[A-Za-z]/.test(bare)) return ''; // "560-568", "45"
  if (!/\d/.test(bare)) return bare;
  return bare.replace(/[01345]/g, (d) => DIGIT_FOR_LETTER[d]);
}

/**
 * A company name read from a STRUCTURED business field (a registration's CorporationName, a permit's contractor company column), or null.
 * cleanOrgName stays the gate for free text; it is strict enough to reject real managing agents here ("STONEHENGE MANAGEMENT LLC":
 * measured, 12 of 111 live agent and owner names pass), so a structured field gets this rule on the same vocabularies. ALL must hold:
 *  S1. Plain ASCII letters, digits, spaces and & . , ' - / ( ) #; no invisible character; no phone, email or link; at most 70 characters.
 *  S2. No role word (hasRoleWord: owner, tenant, trust, estate, c/o ...; and agent, manager, super, same as, n/a, self-managed ...).
 *  S3. A company marker word (COMPANY_MARKERS: LLC, INC, CORP, CO, LP, LLP, HDFC, MANAGEMENT, REALTY, PROPERTIES, ASSOCIATES, HOLDINGS ...).
 *  S4. The rest of the name (marker words, "the", "and", digits and symbols removed). One word left is fine ("PRESTIGE MANAGEMENT INC").
 *      Two or more words left must hold no listed given name and must not read as a person (mentionsPersonName: unknown or surname words
 *      side by side, an initial next to a word): "JOHN SMITH MANAGEMENT LLC" and "J SMITH LLC" fail.
 *  S5. A name that reads as an address ("159 GELSTON AVENUE LLC", an owner entity named for its building) is allowed because the marker is
 *      required and street words are not names; "382 E 197TH STREET" has no marker and fails S3.
 *      The given-name, honorific (DR, MR, MRS, MS, MX, REV ...) and initial checks run on every non-marker word BEFORE street, direction
 *      and digit words are dropped, after digit-for-letter disguises are undone ("J0HN" is "JOHN"): "JOHN WEST LLC", "MARY NORTH INC",
 *      "JOHN LANE LLC", "JAMES COURT MANAGEMENT", "J0HN SMITH LLC" and "DR. PATEL MANAGEMENT INC" fail. A listed given name next to any
 *      other word is a person-named entity, rejected even when the second word is also a street word (privacy first).
 *  S6. Something besides the marker words: a distinctive word or a number ("1864 CORP" passes, "Corporation" does not).
 * A single word never passes (S3). Returns the name with whitespace collapsed, otherwise unchanged.
 */
export function registeredCompanyName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = collapse(raw);
  if (t.length < 5 || t.length > 70) return null;
  if (/[​-‏‪-‮⁠-⁤⁦-⁩﻿­]/.test(t)) return null;
  if (!/^[A-Za-z0-9 &.,'\-/()#]+$/.test(t)) return null;
  if (hasContactShape(t) || hasRoleWord(t) || STRUCTURED_ROLE_RE.test(t)) return null;
  const words = t.split(/[\s,/()]+/).filter(Boolean);
  const isMarker = (w: string) => COMPANY_MARKERS.has(w.toLowerCase().replace(/\.$/, '')) || COMPANY_MARKERS.has(w.toLowerCase());
  if (!words.some(isMarker)) return null;
  const core = words
    .filter((w) => !isMarker(w) && !/^(?:the|and|of|&|dba)$/i.test(w) && !/\d/.test(w) && !STREET_SUFFIX_WORDS.has(w.toLowerCase().replace(/\.$/, '')) && !/^(?:n|s|e|w|north|south|east|west)\.?$/i.test(w))
    .map((w) => w.replace(/[^A-Za-z.'-]/g, ''))
    .filter(Boolean);
  if (/\bdba\b/i.test(t)) return null;
  // A marker alone ("Corporation", "Property Management LLC") names nobody: one distinctive word or a number is required.
  if (core.length === 0 && !words.some((w) => /\d/.test(w))) return null;
  // Person check, run on EVERY non-marker word BEFORE street, direction and digit words are dropped (a surname can be "West", "Lane" or
  // "Court"; a given name can hide as "J0HN"). A given name next to any other word, an honorific, or an initial next to a word is a
  // person-named entity ("JOHN WEST LLC", "MARY NORTH INC", "DR. PATEL MANAGEMENT INC", "J SMITH LLC"): privacy first, reject it.
  const nameWords = words
    .filter((w) => !isMarker(w) && !/^(?:the|and|of|&|dba)$/i.test(w) && !/^\d+$/.test(w) && !ORDINAL_RE.test(w))
    .map(nameFormOf)
    .filter(Boolean);
  // "DR" is also a street word ("OCEAN DR LLC"): it names a person only as the first word.
  if (nameWords.some((w) => COMPANY_NAME_HONORIFICS.has(w.toLowerCase()) && !(w.toLowerCase() === 'dr' && words[0] && nameFormOf(words[0]).toLowerCase() !== 'dr'))) return null;
  if (nameWords.length >= 2) {
    // A compass word is a direction here even where it is also a listed given name ("342 WEST 71 STREET LLC").
    if (nameWords.some((w) => !/^(?:north|south|east|west)$/i.test(w) && isListedGivenName(w))) return null;
    if (nameWords.some((w) => w.length === 1 && !/^[nsew]$/i.test(w)) && nameWords.some((w) => w.length > 1)) return null;
  }
  // One distinctive word next to the marker ("STONEHENGE MANAGEMENT LLC", "PARK MANAGEMENT INC") is a company, even when the word is also a
  // first name. Two or more distinctive words read as a person's full name when they look like one together.
  if (core.length >= 2 && mentionsPersonName(core.join(' '))) return null;
  return t;
}
