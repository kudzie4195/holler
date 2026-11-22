/**
 * Classifier table. Values are written in the shapes the open-data portals publish (upper case DBA columns, "LAST, FIRST M" legal
 * names, contractor company columns). Hand written; none is a real record.
 */

/** Private individuals in every common written form. Every one must be rejected (false-accept target: zero). */
export const PERSON_TRAPS: string[] = [
  // first last, upper and mixed case
  'JOHN SMITH', 'John Smith', 'MARY JOHNSON', 'Robert Williams', 'Kelly Lewis', 'Olga Torres', 'GARRETT MAYS',
  // last, first (+ initial, suffix)
  'SMITH, JOHN A', 'SMITH, JOHN', 'TORRES, OLGA', 'JOHNSON, MARY K.', 'WILLIAMS, ROBERT JR', 'NGUYEN, THANH',
  // initials and suffixes
  'John A. Smith Jr', 'J. Smith', 'JOHN A SMITH', 'REGINALD JACKSON JR', 'Robert Lee III', 'William H. Brown Sr.', 'J R Smith',
  // trade-word surnames with no business form
  'John Mason', 'Mary Carpenter', 'Paul Painter', 'Sam Glass', 'Ann Baker', 'JAMES COOK', 'Linda Gardner', 'Joe Fisher',
  'Tom Weaver', 'David Church', 'Linda Kitchen', 'Karen Temple', 'Robert Banks', 'Michael Co', 'Tony Grill', 'Frank Lodge',
  'Steve Market', 'Dan Barber', 'Gary Plummer', 'Jose Mercado', 'Anna Bank', 'Mike Service', 'Grace Church',
  // Hispanic
  'MARIA ELENA GUTIERREZ', 'Jose Luis Garcia', 'GARCIA LOPEZ, JUAN CARLOS', 'Maria de la Cruz', 'Guadalupe Hernandez-Ramirez',
  'Xochitl Ramirez', 'RAMIREZ, MARIA GUADALUPE',
  // Asian
  'WEI CHEN', 'Nguyen Van Minh', 'KIM, JI HYUN', 'Hiroshi Tanaka', 'Raj Patel', 'Priya Singh', 'LI MING', 'Huynh Thanh Linh',
  // hyphenated, particles, apostrophes
  'Mary-Kate Olsen', "Sean O'Brien", 'Charles von Weise', 'Dana Whitfield-Jones', 'ANNE-MARIE DUBOIS', 'Jean-Pierre Leblanc',
  // credentials
  'Molly Barnett Psy.D', 'JOHN SMITH MD', 'Jane Doe, DDS', 'Mark Lee CPA', 'Angela Rossi RN',
  // couples and symbols that are still people
  'JOHN & MARY SMITH', 'John and Mary Smith', 'JOHN SMITH #12', 'JOHN SMITH 2ND',
  // home daycare under a person's name
  'MARIA LOPEZ', 'Tamika Johnson',
  // surname-first without a comma, weak words after a full name, short Asian names, initials-only business words
  'SMITH JOHN A', 'DELA CRUZ JUAN', "O'NEIL KEVIN", 'CHEN WEI', 'Tran Thi Hoa', 'KUMAR, RAJ', 'Mohammed Ali', 'Jin Na', 'Ann Power',
  'JOHN SMITH PA', 'Mary Ann Church', 'Robert Lee Church', 'Lopez Garcia Church', 'Ahmed Hassan', 'Svetlana Ivanova',
];

/** Placeholders, roles, estates, trusts, contact details, junk. Every one must be rejected. */
export const OTHER_REJECTS: string[] = [
  'OWNER', 'Homeowner', 'SELF', 'N/A', 'SAME AS OWNER', 'OWNER BUILDER', 'TENANT', 'owner/builder', 'NONE', 'UNKNOWN', 'TBD',
  'OWNER: JOHN SMITH', 'ACME ROOFING C/O JOHN SMITH', 'SMITH (HOMEOWNER)',
  'ESTATE OF MARY JONES', 'JOHN SMITH ESTATE', 'SMITH FAMILY TRUST', 'JOHN A SMITH REVOCABLE TRUST', 'JONES LIVING TRUST',
  'JOHN SMITH TRUST', 'SMITH JOHN TR', 'SMITH JOHN ET AL', 'HEIRS OF ROBERT LEE',
  'ACME ROOFING LLC 404-555-0199', 'Acme Roofing (404) 555 0199', 'acme@roofing.com', 'ACME LLC info@acme.com',
  'www.acmeroofing.com', '1234 N MAIN ST', '2318 W 47TH ST',
  'AB', 'X', '', '   ', '12345', 'A'.repeat(121) + ' LLC', 'Joe\'s', 'IBM',
];

/** Organizations. Most must pass; a few are expected false rejections, listed in ORG_EXPECTED_REJECTS. */
export const ORGS: string[] = [
  'ACME ROOFING LLC', 'Smith Roofing', 'J Smith Plumbing LLC', 'SMITH & SONS', 'Smith & Sons Construction', 'JOHN SMITH LLC',
  'ABC ELECTRIC CO.', 'Windy City Cafe', 'JOES TACO SHACK', "Joe's Bar", 'Barton Creek Grill', 'WINDY CITY CAFE',
  'ACME FACILITY SERVICES LLC', 'Bright Smile Dental', 'Lakeview Family Clinic', 'First Baptist Church', 'Grace Bible Church',
  'Lincoln Elementary School', 'University of Texas at Austin', 'City of Chicago', 'Cook County', 'Department of Defense',
  'Chicago Housing Authority', 'Austin Independent School District', 'Chase Bank', 'Hilton Garden Inn Hotel', 'Lakeshore Realty',
  'Oak Street Properties LLC', 'Greystar Management', 'Turner Construction Company', 'Pepper Construction Group', 'Mortenson Builders',
  'Comfort Air HVAC', 'Reliable Mechanical Inc', 'Ace Hardware Store', 'Fresh Market', 'Nail Spa & Salon', 'Holy Family Hospital',
  'Northwestern University', 'Jewel-Osco #3345', '7-ELEVEN #33421', 'AT&T', 'H&R BLOCK', 'A1 Roofing', 'Wright & Associates',
  'Smith Bros', 'Garcia Brothers Landscaping', 'Kim Dental PC', 'Nguyen Nails', 'Patel Pharmacy', 'Hernandez Concrete',
  'JOHN SMITH DBA SMITH ROOFING', 'Maria Lopez d/b/a Lopez Cleaning Services', 'Austin Energy', 'Texas Department of Transportation',
  'US Army Corps of Engineers', 'Lopez Tree Service', 'Main Street Deli', 'Sunrise Bakery', 'Taqueria El Sol', 'Thai Kitchen Restaurant',
  'Cool Air A/C Inc', 'Smith Heating/Cooling LLC', 'Bob\'s Auto Repair', 'Mercy Medical Center', 'The Home Depot', 'Starbucks',
  "McDonald's #12345", 'SUBWAY', 'Morton Salt', 'Oakwood Apartments',
  // round 5 fix: more real-shaped organizations (at least 150 in all)
  'Lopez Family Daycare', 'Little Stars Daycare', 'Happy Kids Learning Center', 'Sunshine Montessori School', 'Golden Dragon Restaurant',
  'Pho Saigon Restaurant', 'Tacos El Guero', 'El Guero Taqueria', 'Panaderia La Esperanza', 'Carniceria Guanajuato', 'Chicago Public Schools',
  'Austin Community College', 'Travis County', 'Harris County Flood Control District', 'Port Authority of New York', 'Metropolitan Water District',
  'Fulton County Board of Education', 'State of Texas', 'Department of Veterans Affairs', 'General Services Administration', 'Army Corps of Engineers',
  'Lockheed Martin Corporation', 'Bechtel National Inc', 'ABM Industries', 'Aramark Services Inc', 'Sodexo Operations LLC', 'Brightview Landscapes LLC',
  'Rollins Inc', 'Terminix Pest Control', 'Orkin Pest Control', 'Roto-Rooter Plumbing', 'Mr. Rooter Plumbing', 'ServiceMaster Restoration',
  'Stanley Steemer Carpet Cleaning', 'Home Depot USA Inc', 'Lowes Home Centers LLC', 'Walgreen Co', 'CVS Pharmacy', 'Kroger Co', 'HEB Grocery Company',
  'Jewel Food Stores', 'Whole Foods Market', 'Costco Wholesale Corporation', 'Target Corporation', 'First National Bank of Texas',
  'Navy Federal Credit Union', 'State Farm Insurance', 'Allstate Insurance Company', 'Northwestern Memorial Hospital', 'Rush University Medical Center',
  'Advocate Health Care', 'Mercy Hospital & Medical Center', "Cook Children's Medical Center", 'Smile Dental Group', 'Austin Regional Clinic',
  'Animal Hospital of Austin', 'Kiddie Academy of Austin', 'Primrose School of Cedar Park', "Domino's Pizza", "Papa John's Pizza", 'Dunkin Donuts',
  'Krispy Kreme Doughnuts', 'Chipotle Mexican Grill', 'Olive Garden Italian Restaurant', 'Buffalo Wild Wings', 'Cracker Barrel Old Country Store',
  'Holiday Inn Express', 'Hampton Inn & Suites', 'Marriott Hotel', 'Motel 6', 'Planet Fitness', 'Great Clips Salon', 'Sally Beauty Supply',
  'Firestone Complete Auto Care', 'Discount Tire', 'Midas Auto Service', 'Sherwin-Williams Company', 'Lone Star Roofing', 'Precision Air Conditioning',
  'ABC Home Services', 'Reliant Energy', 'Austin Electric Company', 'Comfort Systems USA', 'Rosendin Electric', 'Hensel Phelps Construction Co',
  'McCarthy Building Companies', 'Skanska USA Building Inc', 'Gilbane Building Company', 'DPR Construction', 'Lennar Homes LLC', 'ABC Supply Co',
  'Ferguson Plumbing Supply', 'Grainger Industrial Supply', 'Sunbelt Rentals', 'United Rentals Inc', 'Waste Management Inc', 'Republic Services',
  'Allied Universal Security Services', 'Cintas Corporation', 'Securitas Security Services USA', 'ISS Facility Services', 'Chem-Dry Carpet Cleaning',
  'Illinois Department of Public Health', 'Chicago Transit Authority', "Cook County Sheriff's Office", 'New York City Housing Authority',
  'Fairfax County Public Schools', 'University of Illinois at Chicago', 'Georgia Institute of Technology', 'Emory University', 'Grady Memorial Hospital',
  'Atlanta Housing Authority', 'Metropolitan Atlanta Rapid Transit Authority', 'Ebenezer Baptist Church', "St. Mary's Catholic Church",
  'Mount Zion Missionary Baptist Church', 'Islamic Center of Austin', 'Pho 99 Restaurant', 'China Garden Restaurant', 'New China Buffet',
  'Seoul Garden BBQ', 'India Palace Restaurant', 'Thai Basil Cafe', "Jimmy's Deli", "Joe's Pizza", "Rosa's Cafe", "Mama Ninfa's Mexican Restaurant",
  "Lou Malnati's Pizzeria", "Harold's Chicken Shack", 'Blue Bottle Coffee', 'Fifth Third Bank', 'Bank of America',
  // realistic names the default-deny rule is expected to miss
  'Panera Bread', 'Chick-fil-A', 'Taco Bell #1234', 'Pizza Hut of Chicago', "Trader Joe's", 'Wells Fargo Bank NA', 'Golden Corral Buffet',
  'Waffle House #1023', 'Pulte Homes', 'KB Home', 'Jani-King of Austin', 'Molly Maid of Austin', 'TruGreen Lawn Care', 'Temple Beth El',
  'Goddard School of Austin', 'Starbucks Coffee #1234', 'ServPro of North Austin', 'Blue Cross Blue Shield', 'MARTA', "Portillo's Hot Dogs",
];

/**
 * Organizations in ORGS that the strict shape rule (round 5 FIX-C) rejects, measured. Causes: a listed given name ("Austin", "Texas",
 * "Mercy", "Olive", "Joe's"), a business word that is also a listed surname and so is not evidence ("Church", "Bank", "Grill", "Inn",
 * "Hospital", "Center"), more than one unknown word without a strong legal form ("Krispy Kreme Doughnuts"), digits ("Pho 99"), a period
 * that is not a final legal form ("St. Mary's"), a glued "&" with no evidence ("AT&T"). Acceptable: a false reject hides a name, a
 * false accept publishes a person.
 */
export const ORG_EXPECTED_REJECTS = new Set([
  // FIX-F: regenerated from the measured rejects (FIX-E rules plus review4 SURNAME_VOCAB, glued and joined-value rules)
  'Smith Roofing', 'J Smith Plumbing LLC', 'SMITH & SONS', 'Smith & Sons Construction', 'JOHN SMITH LLC', 'Windy City Cafe',
  'JOES TACO SHACK', "Joe's Bar", 'Barton Creek Grill', 'WINDY CITY CAFE', 'First Baptist Church', 'Grace Bible Church',
  'Lincoln Elementary School', 'University of Texas at Austin', 'Department of Defense',
  'Chase Bank', 'Hilton Garden Inn Hotel', 'Turner Construction Company', 'Pepper Construction Group',
  'Ace Hardware Store', 'Fresh Market', 'Nail Spa & Salon', 'Holy Family Hospital', 'Jewel-Osco #3345', '7-ELEVEN #33421', 'AT&T',
  'H&R BLOCK', 'A1 Roofing', 'Wright & Associates', 'Smith Bros', 'Garcia Brothers Landscaping', 'Kim Dental PC', 'Nguyen Nails',
  'Hernandez Concrete', 'JOHN SMITH DBA SMITH ROOFING', 'Maria Lopez d/b/a Lopez Cleaning Services', 'Austin Energy',
  'Texas Department of Transportation', 'Lopez Tree Service', 'Main Street Deli', 'Taqueria El Sol', 'Thai Kitchen Restaurant',
  'Cool Air A/C Inc', 'Smith Heating/Cooling LLC', "Bob's Auto Repair", 'Mercy Medical Center', 'Starbucks', "McDonald's #12345", 'SUBWAY',
  'Morton Salt', 'Oakwood Apartments', 'Little Stars Daycare', 'Happy Kids Learning Center', 'Sunshine Montessori School',
  'Golden Dragon Restaurant', 'Tacos El Guero', 'El Guero Taqueria', 'Panaderia La Esperanza', 'Austin Community College', 'Travis County',
  'Harris County Flood Control District', 'Port Authority of New York', 'Fulton County Board of Education',
  'Lockheed Martin Corporation', 'Aramark Services Inc', 'Rollins Inc', 'Roto-Rooter Plumbing', 'Mr. Rooter Plumbing',
  'Stanley Steemer Carpet Cleaning', 'Lowes Home Centers LLC', 'Walgreen Co', 'Kroger Co',
  'Jewel Food Stores', 'First National Bank of Texas', 'Navy Federal Credit Union', 'Allstate Insurance Company',
  'Northwestern Memorial Hospital', 'Rush University Medical Center', 'Mercy Hospital & Medical Center', "Cook Children's Medical Center",
  'Austin Regional Clinic', 'Animal Hospital of Austin', 'Kiddie Academy of Austin', 'Primrose School of Cedar Park', "Domino's Pizza",
  "Papa John's Pizza", 'Krispy Kreme Doughnuts', 'Chipotle Mexican Grill', 'Olive Garden Italian Restaurant', 'Buffalo Wild Wings',
  'Cracker Barrel Old Country Store', 'Holiday Inn Express', 'Hampton Inn & Suites', 'Motel 6', 'Great Clips Salon', 'Sally Beauty Supply',
  'Firestone Complete Auto Care', 'Midas Auto Service', 'Sherwin-Williams Company',
  'Comfort Systems USA', 'Rosendin Electric', 'Hensel Phelps Construction Co', 'McCarthy Building Companies', 'Gilbane Building Company',
  'Lennar Homes LLC', 'Chem-Dry Carpet Cleaning', "Cook County Sheriff's Office", 'New York City Housing Authority',
  'Georgia Institute of Technology', 'Emory University', 'Grady Memorial Hospital', 'Ebenezer Baptist Church',
  "St. Mary's Catholic Church", 'Mount Zion Missionary Baptist Church', 'Islamic Center of Austin', 'Pho 99 Restaurant',
  'China Garden Restaurant', 'New China Buffet', 'Seoul Garden BBQ', 'India Palace Restaurant', 'Thai Basil Cafe', "Jimmy's Deli",
  "Joe's Pizza", "Rosa's Cafe", "Mama Ninfa's Mexican Restaurant", "Lou Malnati's Pizzeria", "Harold's Chicken Shack",
  'Blue Bottle Coffee', 'Bank of America', 'Panera Bread', 'Chick-fil-A', 'Taco Bell #1234', 'Pizza Hut of Chicago',
  "Trader Joe's", 'Wells Fargo Bank NA', 'Golden Corral Buffet', 'Waffle House #1023', 'Pulte Homes', 'KB Home', 'Jani-King of Austin',
  'Molly Maid of Austin', 'TruGreen Lawn Care', 'Temple Beth El', 'Starbucks Coffee #1234',
  'ServPro of North Austin', 'Blue Cross Blue Shield', 'MARTA', "Portillo's Hot Dogs",
]);

/**
 * A person joined to their company. Only the company part may be returned, and only when it holds no given name or initial; otherwise
 * null. Never a string that still contains the person.
 */
export const JOINED_CASES: [string, string | null][] = [
  // FIX-C: a company part that shares a word with the failing person part is never returned (R8)
  ['JOHN SMITH/SMITH ROOFING', null],
  ['ALEXANDRA VANWAGNER/ADVENTHEALTH MEDICAL GROUP CRI', null],
  ['SMITH ROOFING LLC / JOHN SMITH JR', null],
  ['JOHN SMITH - JOHN SMITH ROOFING', null],
  ['TRAN, THANH HVAC LIC 9912', null],
  ['MARIA LOPEZ - MARIA LOPEZ DAYCARE', null],
  ['JOHN SMITH VICE PRESIDENT ACME ROOFING INC', 'ACME ROOFING INC'],
  ['ACME ROOFING INC REP JOHN SMITH', 'ACME ROOFING INC'],
  ['LOPEZ DAYCARE LLC: MARIA LOPEZ (OWNER)', null],
  ['ACME ROOFING - SIDING DIVISION', 'ACME ROOFING'],
  // FIX-C: moved here from NEW_PERSON_TRAPS; the output holds no word of the person
  ['ACME LLC DBA JOHN SMITH JR', null] /* FIX-E follow-up: was 'ACME LLC' (fragment) */,
  ['ACME HOLDINGS LLC DBA JOHN SMITH', 'ACME HOLDINGS LLC'],
  ['BRENT KOWALSKI @ APEX ROOFING LLC', 'APEX ROOFING LLC'],
  ['APEX ROOFING LLC AT KOWALSKI, BRENT T', 'APEX ROOFING LLC'],
  ['Summit Mechanical KOWALSKI, BRENT T', null],
  ['ZENDAYA OKONJO % Lone Star Grill', null],
  ['Mr. Brent Kowalski Jr FOR APEX ROOFING LLC', 'APEX ROOFING LLC'],
  ['BRENT KOWALSKI (OWNER) APEX ROOFING LLC', null],
];


/** Attack strings by group, copied verbatim from the review's script (/tmp/rev/attack.mts). */
const ATTACK_GROUPS: Record<string, string[]> = {
  'A. plain first-last, mixed case (names outside the built-in lists)': [
    'Brent Kowalski', 'TREVOR NOWAK', 'tiffany abernathy', 'Cody McAllister', 'ERIN OSTROWSKI', 'Wendy Zielinski', 'dErEk vAnDeRbIlT',
    'Stacy Featherstone', 'CHAD LINDQVIST', 'Paula Abramowitz', 'Dustin Hargrove', 'Tracy Okonkwo', 'Shawn Delacroix',
  ],
  'B. last-name-first': [
    'KOWALSKI, BRENT', 'NOWAK TREVOR J', 'OKONKWO, CHINEDU E', 'ABERNATHY TIFFANY', 'Zielinski, Wendy A.', 'VANDERBILT DEREK',
    'OSTROWSKI, ERIN M JR', 'HARGROVE DUSTIN L', 'Featherstone, Stacy', 'LINDQVIST CHAD',
  ],
  'C. initials and suffixes': [
    'B. Kowalski', 'T J Nowak', 'Brent A. Kowalski III', 'C. R. McAllister Jr.', 'E M OSTROWSKI SR', 'W. A. Zielinski II',
    'D L HARGROVE IV', 'P. C. SORCAR', 'L.P. HARTLEY', 'P.C. WREN', 'JOHNSON, P.C.', 'U. S. GRANT', 'GRANT, U S', 'MARY P. C. JONES', 'L P JACKSON',
  ],
  'D. non-English names': [
    'Oluwaseun Adeyemi', 'Nguyen Thi Bich Ngoc', 'Zhang Xiuying', 'Fatoumata Diallo', 'Bartholomew Wojciechowski', 'Siobhan Ni Chonaill',
    'Tatiana Kuznetsova', 'Hyun-woo Park', 'Thandiwe Mahlangu', 'Abdirahman Warsame', 'Yevgeniya Shevchenko', 'Rangi Te Whare',
    'Chukwuemeka Okafor', 'Aroha Ngata', 'Xiomara Quispe Mamani', 'Bjorn Sigurdsson', 'Karthik Subramanian', 'Lupe Tuilagi',
    'SEO-YEON JEONG', 'Emeka Nwosu', 'Deli Mehmet', 'Mehmet Deli', 'Taco van der Hoorn', 'TACO OCKERSE', 'Francisco Solar', 'SOLAR, FRANCISCO',
    'Rodrigo Salon', 'Jean-Luc Bureau', 'BUREAU, JEAN LUC', 'Giuseppe Pizza', 'Ahmet Inc', 'Shlomo Bar', 'Bar Refaeli',
  ],
  'E. surnames/given names that are trade or business words': [
    'John Burger', 'BURGER, JOHN A', 'Warren Burger', 'Mary Coffee', 'COFFEE, MARY', 'John Coffee', 'Bruce Arena', 'ARENA, MARIA', 'Maria Arena',
    'Joyce Brothers', 'BROTHERS, JOYCE', 'Gabrielle Union', 'UNION, GABRIELLE', 'Floyd Council', 'COUNCIL, FLOYD', 'Beauty Dlamini', 'Maria Montessori',
    'MONTESSORI, MARIA', 'James Wines', 'WINES, JAMES', 'Jimmy Buffet', 'Helen Diner', 'Jean Baptist', 'Tom Fence', 'Janet League', 'Peter School',
    'Minnie Coop', 'Paul Bureau', 'Anna Salon', 'Robert Hardware', 'Sally Fields', 'Billy Mills', 'Bob Hope', 'Christian Slater', 'Stone Phillips',
    'Rich Hall', 'Rose Mason', 'Hunter Painter', 'Mason Carpenter', 'Carter Glass', 'Taylor Cook', 'Parker Baker', 'Dean Cain', 'Penny Marshall',
    'Jack Black', 'Betty White', 'Tiger Woods', 'Bishop Lamont', 'Major Garrett', 'King Kelly', 'Prince Fielder', 'Duke Snider',
  ],
  'F. weak-word surnames in First M Last / three-word / honorific form': [
    'TREVOR J LAW', 'ERIN M CHURCH', 'CODY R KITCHEN', 'SHANIQUA R PARISH', 'BRENT A TEMPLE', 'Juno Violet Temple', 'Cabot Winthrop Lodge',
    'Thandiwe Nomsa Church', 'MR TREVOR LAW', 'MRS ERIN KITCHEN', 'MS TIFFANY CHURCH', 'DR WENDY BANK', 'Tiffany Renee Market', 'DUSTIN L STORE',
    'Chad Everett Bar', 'TRACY L COLLEGE', 'Jude Heyworth Law', 'Stacy Lynn Service', 'PAULA K GRILL', 'Derek Shane Garage', 'Wendy Jo Inn',
    'Shlomo Ben Bar', 'CRYSTAL D CHAPEL', 'DARNELL T MART', 'Brent Tyler Studio',
  ],
  'G. names with "Inc"-like / legal-form fragments': [
    'Vince Lombardi', 'Linc Hayes', 'INCE, THOMAS', 'Corpus Christi Rodriguez', 'Ltd Edwards', 'Marco Polo', 'Francisco Lopez', 'Nico Rossi',
    'MICHAEL CO.', 'Jose Co. Jr', 'CO., MICHAEL', "D'Inc Williams", 'Kim-Inc Lee', 'Pc Sharma', 'PC SREERAM', 'LP FIELD', 'Corp. John Smith',
    'Kim Co', 'Alicia Limited', 'Mary Company',
  ],
  'H. names followed by licence numbers / ids / unit fragments': [
    'JOHN SMITH LIC#4521', 'JOHN SMITH LIC# 12345', 'MARIA LOPEZ TACLB12345E', 'ROBERT JOHNSON M-12345', 'JOHN SMITH C-10 #123456',
    'BRENT KOWALSKI #4521', 'KOWALSKI, BRENT #12', 'JOHN SMITH MP12345', 'MARY JOHNSON EC13001234', 'JOSE GARCIA CBC1257898',
    'JOHN SMITH #12345', 'JOHN SMITH LIC 12345', 'TREVOR NOWAK 12345', 'JOHN SMITH APT 2B', 'MARIA LOPEZ UNIT4', 'WEI CHEN RME-7781',
    'SMITH, JOHN A TX12345', 'JOHN A SMITH JR ME123456', 'Tamika Johnson ID#99812', 'JOHN SMITH 4TH', 'RAJ PATEL PE#88123', 'JOHN SMITH NO. 4521',
    'SMITH JOHN 19B7781', 'MARY K JOHNSON L1234',
  ],
  'I. two people joined': [
    'JOHN&MARY SMITH', 'BOB&SUE JONES', 'J&M SMITH', 'TOM&ANN KOWALSKI', 'Brent and Erin Kowalski', 'KOWALSKI BRENT & ERIN', 'JOHN SMITH AND MARY JONES',
    'SMITH, JOHN & MARY', 'John Smith + Mary Jones', 'JOHN SMITH; MARY JONES', 'JOHN SMITH / MARY JONES', 'MARIA Y JOSE GARCIA', 'Brent Kowalski, Erin Nowak',
    'WEI&LI CHEN', 'John Smith or Mary Smith', 'MR & MRS JOHN SMITH', 'MR&MRS SMITH', 'RAJ&PRIYA PATEL',
  ],
  'J. doing-business-as strings that are really a person': [
    'JOHN SMITH DBA JOHN SMITH', 'MARIA LOPEZ DBA MARIA', 'MARIA LOPEZ DBA MARIA LOPEZ LIC#123', 'JOHN SMITH D/B/A J SMITH', 'JOHN SMITH AKA JOHNNY SMITH',
    'BRENT KOWALSKI DBA BRENT KOWALSKI', 'BRENT KOWALSKI T/A KOWALSKI', 'JOHN SMITH DBA JOHN&MARY SMITH', 'MARIA LOPEZ DBA M LOPEZ #2',
    'JOHN SMITH TRADING AS JOHN SMITH JR', 'TAMIKA JOHNSON DBA TAMIKA J', 'JOHN SMITH DBA JOHN BURGER', 'KOWALSKI BRENT DBA SELF', 'JOHN SMITH DBA', 'DBA JOHN SMITH',
    'JOHN SMITH DOING BUSINESS AS JOHN', 'Wei Chen dba Chen Wei', 'JOHN SMITH DBA JOHN SMITH 2B',
  ],
  'K. person joined to their company with a separator other than "/" (owner name would be stored)': [
    'JOHN SMITH - SMITH ROOFING', 'SMITH ROOFING - JOHN SMITH', 'JOHN SMITH, SMITH ROOFING LLC', 'JOHN SMITH; SMITH ROOFING', 'JOHN SMITH | SMITH ROOFING',
    'SMITH ROOFING JOHN SMITH', 'JOHN SMITH \\ SMITH ROOFING', 'MARIA LOPEZ - LOPEZ DAYCARE LLC', 'SMITH ROOFING LLC: JOHN SMITH', 'JOHN SMITH OF SMITH ROOFING',
    'JOHN SMITH PRESIDENT SMITH ROOFING INC', 'SMITH ROOFING CONTACT JOHN SMITH',
  ],
  'L. person + job title / role containing a business word': [
    'JOHN SMITH OFFICE MANAGER', 'MARIA LOPEZ PROPERTY MANAGER', 'JOHN SMITH BUILDING SUPERINTENDENT', 'JANE DOE SCHOOL PRINCIPAL', 'JOHN SMITH COUNTY CLERK',
    'ROBERT JOHNSON HEALTH INSPECTOR', 'JOHN SMITH, AGENT', 'JOHN SMITH CONTRACTOR', 'MARIA LOPEZ ELECTRICAL CONTRACTOR', 'JOHN SMITH DESIGN PROFESSIONAL',
    'JOHN SMITH ARCHITECT', 'JOHN SMITH ENGINEER', 'WEI CHEN PROJECT MANAGER', 'John Smith Nursing Assistant', 'JOHN SMITH MEDICAL DIRECTOR',
  ],
  'M. home daycare / honorific / misc person forms': [
    'MS MARIA LOPEZ', 'Mr. John Smith', 'DR JOHN SMITH', 'Rev. Tamika Johnson', 'SISTER MARY CLARENCE', 'BROTHER JOHN SMITH', 'SISTERS MARY AND ANN',
    'MARIA LOPEZ (HOME)', 'LOPEZ MARIA G', 'Maria G. Lopez-Hernandez', 'JOHN SMITH SELF', 'JOHN "JACK" SMITH', "JOHN O'MALLEY-SMITH", 'SMITH JOHN A & SMITH MARY B',
    'JOHN SMITH 512-555-0100x12', 'JOHN SMITH PH5125550100', 'JOHN SMITH 5550100',
  ],
};

/**
 * Group K: the company part used to be returned. Round 5 FIX-C (R8): every K value's company part shares a word with the person
 * ("SMITH", "LOPEZ"), so every one is now null. Kept as an empty map so the flip is visible.
 */
const ATTACK_K_EXPECTED: Record<string, string> = {};

/**
 * Round 5 fix: personal-name traps in shapes the review did not try (suffix words, reversed order with license tokens, three-part
 * Hispanic names with a business-word surname, hyphenated business-word surnames, THE, quotes, OWNER, ET UX, AKA, C/O, ATTN, FBO,
 * trusts, estates, job titles, honorifics, initials, glued digits and phones, legal-form fragments). Every one must be rejected.
 */
export const NEW_PERSON_TRAPS: string[] = [
  // suffix words
  'JOHN SMITH JR', 'ROBERT LEE SR.', 'WILLIAM H BROWN III', 'JAMES WILSON IV', 'DAVID MOORE 2ND', 'MICHAEL JONES JUNIOR', 'THOMAS CLARK SENIOR',
  'SMITH, JOHN JR.', 'GARCIA, JOSE III', 'Brent Kowalski Jr.', 'TREVOR NOWAK SR', 'Cody McAllister II', 'DARNELL T WASHINGTON JR', 'Wei Chen Jr', 'RAJ PATEL SR.',
  // reversed order with license or id tokens
  'SMITH JOHN LIC 4521', 'LOPEZ MARIA TACLB998877', 'NGUYEN THANH #ROC 33221', 'PATEL RAJ EC1300456', 'GARCIA JOSE A CBC1258899', 'KOWALSKI BRENT M-4412',
  'JOHNSON MARY K L# 77812', 'CHEN WEI RME 7781', 'WILLIAMS ROBERT ME-55121', 'BROWN JAMES R #4521 UNIT 2', 'OKAFOR CHINEDU LIC#A-99812', 'HERNANDEZ LUIS 2B',
  'SMITH, JOHN LIC NO 33412', 'Kowalski, Brent ID 55-1212', 'TRAN, THANH HVAC LIC 9912',
  // three-part Hispanic names with a business-word surname
  'MARIA ELENA SALON', 'JOSE LUIS ARENA GARCIA', 'JUAN CARLOS SOLAR RUIZ', 'LUIS ALBERTO DELI', 'ROSA MARIA DINER', 'CARLOS ALBERTO UNION',
  'MIGUEL ANGEL TACO', 'JOSE ANTONIO PIZZA', 'MARIA DEL CARMEN SALON', 'FRANCISCO JAVIER BUREAU', 'JUAN PABLO LEAGUE', 'ANA SOFIA MONTESSORI',
  'PEDRO PABLO BURGER', 'MARIA JOSE BAPTIST', 'JOSE LUIS HERRERO', 'MARIA ELENA PANADERO', 'ANA LUCIA IGLESIAS MERCADO', 'GUADALUPE ARENA SOLAR',
  // hyphenated business-word surnames
  'MARY CHURCH-TEMPLE', 'JOHN BURGER-KING', 'ANNA SALON-LOPEZ', 'ROBERT LOPEZ-ROOFING', 'MARIA GARCIA-PLUMBING', 'SARAH COFFEE-SMITH',
  'DAVID BAKER-MASON', 'LINDA MARKET-HALL', 'KAREN UNION-JONES', 'PAUL ARENA-DIAZ', 'EMMA SOLAR-REYES', 'LUCY DINER-WOODS',
  'TOM HARDWARE-BELL', 'NANCY BANK-HOLLAND', 'JOSE PIZZA-RUIZ', 'COFFEE-SMITH, SARAH',
  // names with THE
  'THE JOHN SMITH', 'JOHN SMITH THE THIRD', 'THE SMITHS', 'THE JONES FAMILY', 'THE GARCIAS', 'THE REV JOHN SMITH', 'JOHN THE BAKER',
  'MARIA THE TAILOR', 'THE LOPEZ HOUSEHOLD', 'THE MARY JONES', 'THE KOWALSKI HOME', 'THE HONORABLE MARY JONES',
  // names in quotes
  '"JOHN SMITH"', "'MARIA LOPEZ'", '“Tamika Johnson”', 'JOHN "BIG JOHN" SMITH', 'MARIA "LUPE" GARCIA', '"SMITH, JOHN A"',
  '"DR. JOHN SMITH"', '“WEI CHEN”', "JOHN 'JACK' SMITH", '"MARY COFFEE"',
  // trailing OWNER and person roles
  'JOHN SMITH OWNER', 'SMITH ROOFING OWNER JOHN SMITH', 'MARIA LOPEZ - OWNER', 'JOHN SMITH (OWNER)', 'OWNER JOHN SMITH', 'JOHN SMITH, OWNER',
  'JOHN SMITH PROPERTY OWNER', 'JOHN SMITH HOMEOWNER', 'SMITH JOHN OWNER/BUILDER', 'MARY JONES OWNER OCCUPIED', 'JOHN SMITH OWNER OF SMITH ROOFING',
  // ET UX, ET AL, ET VIR
  'SMITH JOHN ET UX', 'JOHN SMITH ET UX', 'GARCIA JOSE & MARIA ET UX', 'SMITH JOHN A ETUX', 'JONES MARY ET VIR', 'LOPEZ MARIA ET AL',
  'SMITH ROOFING JOHN SMITH ET AL', 'KOWALSKI BRENT ETAL',
  // AKA
  'JOHN SMITH AKA JACK SMITH', 'MARIA LOPEZ A/K/A MARIA GARCIA', 'JOHN SMITH A.K.A. SMITTY', 'ACME ROOFING LLC AKA JOHN SMITH', 'WEI CHEN AKA WILLIAM CHEN',
  'JOSE GARCIA AKA PEPE', 'TAMIKA JOHNSON AKA TAMMY J', 'SMITH ROOFING AKA JOHN',
  // C/O and ATTN
  'JOHN SMITH C/O MARY SMITH', 'C/O JOHN SMITH', 'ACME LLC C/O JOHN SMITH', 'MARIA LOPEZ C/O LOPEZ DAYCARE', 'SMITH ROOFING C/O JOHN', 'CARE OF JOHN SMITH',
  'ATTN JOHN SMITH', 'ATTN: MARY JONES', 'SMITH ROOFING ATTN JOHN SMITH', 'ACME LLC ATTENTION JOHN', 'JOHN SMITH ATTN', 'ATTN SMITH ROOFING LLC',
  // FBO, custodian, guardian
  'JOHN SMITH FBO MARY SMITH', 'FBO JOHN SMITH IRA', 'ACME TRUST CO FBO JOHN SMITH', 'SMITH JOHN F/B/O SMITH MARY', 'CUSTODIAN FBO JANE DOE',
  'JOHN SMITH CUST MARY SMITH UTMA', 'MARY JONES GUARDIAN OF JOHN JONES', 'JOHN SMITH EXECUTOR',
  // trusts
  'JOHN SMITH LIVING TRUST', 'SMITH FAMILY REVOCABLE TRUST', 'THE JOHN AND MARY SMITH TRUST', 'MARY JONES TRUSTEE', 'JOHN SMITH TTEE',
  'SMITH JOHN TR UA 01/02/2003', 'GARCIA JOSE TRUST DTD 2005', 'LOPEZ MARIA IRREVOCABLE TRUST', 'KOWALSKI BRENT TRUSTEE OF THE KOWALSKI TRUST',
  'ROBERT LEE GRANTOR TRUST', 'JOHN SMITH TRUST U/A',
  // estates
  'ESTATE OF JOHN SMITH', 'SMITH JOHN EST', 'THE ESTATE OF MARIA LOPEZ', 'JOHN SMITH DECEASED', 'HEIRS OF MARY JONES', "SMITH JOHN DEC'D",
  'MARY JONES LIFE ESTATE', 'JOHN SMITH (DECEASED)', 'EST OF ROBERT LEE',
  // person plus a job title holding a business word
  'JOHN SMITH SALES MANAGER', 'MARIA LOPEZ RESTAURANT MANAGER', 'JOHN SMITH PLUMBING CONTRACTOR', 'WEI CHEN SCHOOL NURSE', 'JOHN SMITH CHURCH PASTOR',
  'MARY JONES BANK OFFICER', 'ROBERT BROWN HOTEL MANAGER', 'JAMES WILSON FIRE INSPECTOR', 'LINDA DAVIS CITY CLERK', 'DAVID MILLER COUNTY ENGINEER',
  'SARAH TAYLOR DENTAL ASSISTANT', 'KEVIN WHITE AUTO MECHANIC', 'MIKE JONES ROOFING CONTRACTOR', 'TOM CLARK ELECTRICAL ENGINEER',
  'JOHN SMITH CONSTRUCTION SUPERVISOR', 'J SMITH HVAC TECHNICIAN',
  // several people
  'JOHN SMITH - MARY JONES', 'SMITH, JOHN - SMITH, MARY', 'JOHN SMITH; MARY SMITH; BOB SMITH', 'JOHN SMITH/MARY JONES/BOB LEE',
  // honorifics
  'MR. AND MRS. JOHN SMITH', 'MR & MRS SMITH', 'DR. MARIA LOPEZ DDS', 'REV DR JOHN SMITH', 'PASTOR JOHN SMITH', 'SISTER MARY JOSEPH',
  'FATHER JOHN SMITH', 'HON. MARY JONES', 'PROF WEI CHEN', 'CAPT JOHN SMITH', 'JUDGE MARY JONES', 'MS. TAMIKA JOHNSON', 'BISHOP T D JONES',
  // initials with a business-word surname
  'J. BURGER', 'M. COFFEE', 'A. B. SALON', 'R J UNION', 'K. ARENA', 'T COUNCIL', 'J P PIZZA', 'S. DELI', 'J.R. BAPTIST',
  // given name plus one ambiguous word
  'Faith Temple', 'Hope Chapel', 'Joy Market', 'Destiny Salon', 'Trinity Church', 'Summer Inn', 'Ruby Bar', 'Crystal Spa', 'Grace Kitchen',
  // digits glued to names
  'JOHNSMITH123', 'MARIA LOPEZ2', 'JOHN SMITH#2', 'J0HN SMITH',
  // glued or labelled phones
  'JOHN SMITH 5125550100', 'JOHN SMITH (512)555-0100 EXT 4', 'SMITH ROOFING 512.555.0100x9', 'JOHN SMITH PH:512-555-0100',
  // comma and legal-form fragments
  'SMITH, P.A.', 'JONES, PC', 'LOPEZ, P.C.', 'GARCIA, CO.', 'SMITH, JOHN, P.A.', 'JOHNSON, M.D., P.C.', 'WEI, LLC',
  // DBA forms whose trade name is a person
  'JOHN SMITH DBA MARY SMITH', 'MARIA LOPEZ D/B/A M. LOPEZ', 'JOHN SMITH DBA J SMITH #4', 'SMITH ROOFING LLC DBA JOHN SMITH LIC 22',
  // person after a business word with no separator
  'SMITH PLUMBING MARY SMITH', 'ACME CONSTRUCTION J SMITH', 'LOPEZ DAYCARE MARIA LOPEZ', 'ROOFING BY JOHN SMITH', 'LAW OFFICE OF JOHN SMITH',
  'HAIR BY MARIA LOPEZ',
];

/**
 * The privacy review's attack table (review-privacy.md, 272 strings, groups A to M), with the required result. Group K keeps only the
 * company part; every other string must be rejected.
 */
export const ATTACK_TABLE: Record<string, [string, string | null][]> = Object.fromEntries(
  Object.entries(ATTACK_GROUPS).map(([group, names]) => [group, names.map((n): [string, string | null] => [n, ATTACK_K_EXPECTED[n] ?? null])]),
);

/**
 * Round 5 FIX-C: the second review's joined-string generator (review2.md, "Joined strings"): 6 person forms x 5 companies x 95
 * separators x 2 orders, plus separators of our own. Every output must hold no word of the person's name (null is fine).
 */
export const JOINED_PERSONS = ['BRENT KOWALSKI', 'Ingrid Halvorsen', 'ZENDAYA OKONJO', 'KOWALSKI, BRENT T', 'B. Kowalski', 'Mr. Brent Kowalski Jr'];
export const JOINED_COMPANIES = ['APEX ROOFING LLC', 'Summit Mechanical', 'Lone Star Grill', 'City of Austin', 'KOWALSKI ROOFING'];
/** [label, separator]. The first 95 are the review's, in its order; 'paren' and 'bracket' wrap the second item. */
export const REVIEW2_SEPARATORS: [string, string][] = [
  ['space-dash-space', ' - '], ['dash', '-'], ['en dash', ' – '], ['em dash', ' — '], ['em dash tight', '—'], ['double dash', ' -- '],
  ['nb hyphen U+2011', ' ‑ '], ['minus U+2212', ' − '], ['horizontal bar U+2015', ' ― '], ['slash', '/'], ['slash spaced', ' / '],
  ['double slash', ' // '], ['backslash', ' \\ '], ['semicolon', '; '], ['pipe', ' | '], ['colon', ': '], ['comma', ', '], ['fullwidth comma', '，'],
  ['fullwidth slash', '／'], ['fullwidth pipe', '｜'], ['middle dot', ' · '], ['bullet', ' • '], ['asterisk', ' * '], ['tilde', ' ~ '],
  ['equals', ' = '], ['gt', ' > '], ['arrow', ' -> '], ['plus', ' + '], ['ampersand', ' & '], ['and', ' AND '], ['at sign', ' @ '],
  ['percent', ' % '], ['hash', ' # '], ['underscore', '_'], ['spaced underscore', ' _ '], ['period', '. '], ['ellipsis', '...'], ['tab', '\t'],
  ['newline', '\n'], ['two spaces', '  '], ['single space', ' '], ['zero width space', '​'], ['quote', ' " '], ['apostrophe', " ' "],
  ['caret', ' ^ '], ['question', ' ? '], ['bang', ' ! '],
  ['for', ' FOR '], ['of', ' OF '], ['at', ' AT '], ['with', ' WITH '], ['w/', ' W/ '], ['by', ' BY '], ['via', ' VIA '], ['from', ' FROM '],
  ['obo', ' OBO '], ['on behalf of', ' ON BEHALF OF '], ['agent for', ' AGENT FOR '], ['rep', ' REP '], ['c/o', ' C/O '], ['attn', ' ATTN '],
  ['dba', ' DBA '], ['d/b/a', ' D/B/A '], ['d.b.a.', ' D.B.A. '], ['d b a', ' D B A '], ['dba:', ' DBA: '], ['(dba)', ' (DBA) '], ['dba-', ' DBA- '],
  ['doing business as', ' doing business as '], ['t/a', ' T/A '], ['trading as', ' TRADING AS '], ['aka', ' AKA '], ['a/k/a', ' A/K/A '],
  ['fka', ' FKA '], ['f/k/a', ' F/K/A '], ['nka', ' NKA '], ['o/a', ' O/A '], ['operating as', ' OPERATING AS '], ['owner of', ' OWNER OF '],
  ['president of', ' PRESIDENT OF '], ['qualifier', ' QUALIFIER '], ['qualifier for', ' QUALIFIER FOR '], ['member of', ' MEMBER OF '],
  ['lic holder', ' LICENSE HOLDER '], ['employee of', ' EMPLOYEE OF '], ['works for', ' WORKS FOR '], ['ceo', ' CEO '], ['mgr', ' MGR '],
  ['prop', ' PROP '], ['proprietor', ' PROPRIETOR '], ['(owner)', ' (OWNER) '], ['paren', ' ('], ['bracket', ' ['], ['lic no', ' LIC 4521 '],
  ['hash id', ' #4521 '],
];
/** Separators of our own (FIX-C). */
export const FIXC_SEPARATORS: [string, string][] = [
  ['or', ' OR '], ['and/or', ' AND/OR '], ['vs', ' VS '], ['nee', ' NEE '], ['formerly', ' FORMERLY '], ['successor to', ' SUCCESSOR TO '],
  ['licensee', ' LICENSEE '], ['inspector', ' INSPECTOR '], ['manager', ' MANAGER '], ['director', ' DIRECTOR '], ['principal', ' PRINCIPAL '],
  ['contact', ' CONTACT '], ['poc', ' POC '], ['fbo', ' FBO '], ['in care of', ' IN CARE OF '], ['crlf', '\r\n'], ['vertical tab', '\v'],
  ['nbsp', ' '], ['figure dash', ' ‒ '], ['small hyphen', ' ﹣ '], ['fullwidth hyphen', ' － '], ['double colon', ' :: '],
  ['fat arrow', ' => '], ['angle pair', ' <> '], ['broken bar', ' ¦ '], ['double bar', ' ‖ '], ['dollar', ' $ '], ['curly quotes', ' “ '],
  ['guillemet', ' « '], ['word joiner', '⁠'], ['soft hyphen', '­'], ['bom', '﻿'], ['rtl mark', '‏'], ['ideographic space', '　'],
  ['brace', ' {'], ['period tight', '.'], ['comma tight', ','], ['semicolon tight', ';'], ['colon tight', ':'], ['hyphen left', ' -'], ['hyphen right', '- '],
  ['dot dash', ' .- '], ['bullet tight', '•'], ['middle dot tight', '·'], ['ellipsis char', ' … '], ['id label', ' ID 99812 '],
  ['unit', ' UNIT 4 '], ['phone', ' 512-555-0100 '], ['email', ' bk@example.com '], ['domain', ' example.com '],
];
export const JOINED_SEPARATORS: [string, string][] = [...REVIEW2_SEPARATORS, ...FIXC_SEPARATORS];

/** Every generated joined string with its person, in both orders. */
export function joinedStrings(): { s: string; person: string; company: string; label: string }[] {
  const out: { s: string; person: string; company: string; label: string }[] = [];
  for (const p of JOINED_PERSONS) {
    for (const c of JOINED_COMPANIES) {
      for (const [label, sep] of JOINED_SEPARATORS) {
        for (const order of [0, 1]) {
          const [a, b] = order === 0 ? [p, c] : [c, p];
          let s = `${a}${sep}${b}`;
          if (label === 'paren') s = `${a} (${b})`;
          if (label === 'bracket') s = `${a} [${b}]`;
          if (label === 'brace') s = `${a} {${b}}`;
          out.push({ s, person: p, company: c, label });
        }
      }
    }
  }
  return out;
}

/** Words of a person's name (2+ letters, honorifics and suffixes left out): none may appear in an output. */
export function personWords(person: string): string[] {
  return person
    .toLowerCase()
    .replace(/[^a-z ]/g, ' ')
    .split(' ')
    .filter((w) => w.length > 1 && !['mr', 'jr'].includes(w));
}

/**
 * Round 5 FIX-C: 150 more realistic organization names (restaurants, contractors, retailers, churches, daycares with non-personal names,
 * agencies), written before they were measured. Hand written; none is a real record. The strict rule rejects many of them (measured
 * list in ORG_EXPECTED_REJECTS): a false reject hides a name, a false accept publishes a person.
 */
export const NEW_ORGS: string[] = [
  // restaurants and food
  'Golden Dragon Chinese Restaurant', 'Pho Hoa Noodle Soup', 'El Rancho Taqueria', 'Los Compadres Mexican Grill', 'Bangkok Thai Cuisine',
  'Mediterranean Grill & Bakery', 'Sunrise Donuts', 'Southern Comfort Barbecue', 'Lone Wolf Pizzeria', 'Blue Moon Diner', 'Red Lantern Sushi',
  'Coastal Seafood Market', 'Taqueria Los Altos', 'Panaderia El Sol', 'Halal Kabob House', 'Saigon Bistro', 'Peking Garden Restaurant',
  'Cajun Crawfish Kitchen', 'Big Sky Bagels', 'Twin Peaks Brewing Company', 'Third Coast Coffee Roasters', 'Urban Taco Bar', 'Lucky Wok',
  'Fresh Harvest Catering', 'Sweet Treats Bakery', 'Crescent Moon Cafe', 'Smokehouse BBQ Co', 'Pupuseria La Bendicion', 'Seoul Food Korean BBQ',
  'Tandoori Nights Indian Cuisine', 'Brick Oven Pizzeria', 'Green Leaf Salad Bar', 'Hometown Buffet', 'Northside Tavern', 'Riverbend Brewery',
  'Pacific Rim Sushi', 'Oak Barrel Winery', 'Copper Kettle Creamery', 'Desert Rose Cantina', 'Silver Spoon Cafe',
  // contractors and trades
  'Summit Roofing & Construction', 'Precision Plumbing Services', 'Allied Electrical Contractors', 'Patriot HVAC LLC', 'Bluebonnet Landscaping',
  'Superior Concrete Works', 'Lone Oak Fencing', 'Apex Painting Contractors', 'Reliable Pest Solutions', 'Diamond Pools & Spas',
  'Cornerstone Builders Inc', 'Eagle Drywall Inc', 'Ironclad Welding & Fabrication', 'Evergreen Tree Care', 'ProClean Janitorial Services',
  'Metro Elevator Company', 'Pinnacle Mechanical Inc', 'Gulf Coast Restoration', 'Keystone Masonry', 'Heartland Insulation',
  'Northstar Excavating LLC', 'Crystal Clear Window Cleaning', 'Bulldog Towing', 'Two Rivers Paving', 'Granite State Plumbing',
  'Liberty Electric Co', 'Atlas Demolition Corp', 'Integrity Flooring LLC', 'Mighty Movers', 'Hometown Septic Services',
  'Canyon Creek Irrigation', 'Pristine Pressure Washing', 'Arrow Sign Company', 'Benchmark Surveying', 'Titan Steel Erectors',
  'Gutter Pros LLC', 'Elite Garage Doors', 'All Star Locksmith', 'Prestige Cabinetry', 'Midwest Waterproofing',
  // retailers and services
  'Corner Hardware & Supply', 'Main Street Pharmacy', 'Discount Tire & Auto', 'Northgate Laundromat', 'Bright Smiles Pediatric Dentistry',
  'Valley Veterinary Clinic', 'Sunset Animal Hospital', 'Parkside Family Medicine', 'Clear View Optical', 'Fitness Factory Gym',
  'Iron Horse Motors', 'Midtown Collision Center', 'Westside Liquor', 'Neighborhood Food Mart', 'Downtown Dry Cleaners', 'Lakeside Marina',
  'Cityview Apartments', 'Redwood Self Storage', 'Harbor Freight Tools', 'Mountain View Hotel', 'Riverside Inn & Suites', 'Express Car Wash',
  'Golden Scissors Barbershop', 'Polished Nail Salon', 'Northwest Insurance Agency',
  // churches and faith
  'New Hope Baptist Church', 'Greater Mount Calvary Church', 'First United Methodist Church', 'Holy Cross Lutheran Church',
  'Iglesia Bautista Nueva Vida', 'Christ the King Catholic Church', 'Beth Israel Synagogue', 'Islamic Society of North America',
  'Cornerstone Community Church', 'Living Waters Fellowship',
  // daycares and schools with non-personal names
  'Little Sprouts Daycare', 'Rainbow Kids Learning Center', 'Bright Beginnings Preschool', 'Tiny Tots Childcare', 'Sunflower Montessori Academy',
  'Discovery Kids Academy', 'Kids Kingdom Daycare', 'Building Blocks Child Care', 'Busy Bees Preschool', 'Learning Tree Academy',
  // agencies and public bodies
  'Fulton County Department of Health', 'City of Atlanta Department of Watershed Management', 'Chicago Park District', 'Cook County Board of Review',
  'Metropolitan Transit Authority', 'Illinois Department of Transportation', 'Georgia Department of Revenue', 'Seattle Public Utilities',
  'Los Angeles Unified School District', 'Department of Housing and Urban Development', 'Federal Emergency Management Agency',
  'Environmental Protection Agency', 'Port of Seattle', 'Town of Cary', 'Village of Oak Park',
  // other organizations
  'Habitat for Humanity', 'Boys & Girls Club', 'United Way of Greater Atlanta', 'Goodwill Industries', 'Salvation Army Family Store',
  'Meals on Wheels', 'American Red Cross', 'Lakeshore Credit Union', 'Pioneer Title Company', 'Summit Property Management',
];

/** NEW_ORGS the strict rule rejects, measured after the vocabulary growth (50 before it, see fix-c.md; "Bluebonnet" is a glued given name). */
export const NEW_ORG_EXPECTED_REJECTS = new Set([
  // FIX-F: regenerated from the measured rejects (FIX-E rules plus review4 SURNAME_VOCAB, glued and joined-value rules)
  'Golden Dragon Chinese Restaurant', 'Pho Hoa Noodle Soup', 'El Rancho Taqueria', 'Los Compadres Mexican Grill', 'Bangkok Thai Cuisine',
  'Mediterranean Grill & Bakery', 'Southern Comfort Barbecue', 'Lone Wolf Pizzeria', 'Blue Moon Diner', 'Red Lantern Sushi',
  'Taqueria Los Altos', 'Panaderia El Sol', 'Peking Garden Restaurant', 'Cajun Crawfish Kitchen', 'Big Sky Bagels',
  'Twin Peaks Brewing Company', 'Third Coast Coffee Roasters', 'Urban Taco Bar', 'Lucky Wok', 'Fresh Harvest Catering',
  'Crescent Moon Cafe', 'Pupuseria La Bendicion', 'Green Leaf Salad Bar', 'Hometown Buffet', 'Northside Tavern', 'Riverbend Brewery',
  'Pacific Rim Sushi', 'Oak Barrel Winery', 'Copper Kettle Creamery', 'Desert Rose Cantina', 'Silver Spoon Cafe',
  'Bluebonnet Landscaping', 'Diamond Pools & Spas', 'Crystal Clear Window Cleaning', 'Two Rivers Paving',
  'Atlas Demolition Corp', 'Canyon Creek Irrigation', 'Benchmark Surveying', 'Titan Steel Erectors',
  'Gutter Pros LLC', 'Elite Garage Doors', 'All Star Locksmith', 'Corner Hardware & Supply', 'Neighborhood Food Mart', 'Lakeside Marina',
  'Riverside Inn & Suites', 'Golden Scissors Barbershop', 'Polished Nail Salon', 'New Hope Baptist Church',
  'Holy Cross Lutheran Church', 'Iglesia Bautista Nueva Vida', 'Christ the King Catholic Church', 'Beth Israel Synagogue',
  'Islamic Society of North America', 'Living Waters Fellowship', 'Little Sprouts Daycare',
  'Rainbow Kids Learning Center', 'Bright Beginnings Preschool', 'Sunflower Montessori Academy', 'Building Blocks Child Care',
  'Busy Bees Preschool', 'Fulton County Department of Health', 'City of Atlanta Department of Watershed Management',
  'Georgia Department of Revenue', 'Los Angeles Unified School District',
  'Department of Housing and Urban Development', 'Town of Cary', 'Habitat for Humanity',
  'United Way of Greater Atlanta', 'Goodwill Industries', 'Salvation Army Family Store', 'Meals on Wheels', 'American Red Cross',
  'Lakeshore Credit Union',
]);

/**
 * The second review's person strings (review2.md, Batch A 575 + 2 it skipped, Batch B 129 with 'JOHN SMITH LLC'), copied verbatim from
 * its scripts (/tmp/rev2/attack_list.ts, attack2.rev.ts). Every one must give null, except REVIEW2_ALLOWED.
 */
export const REVIEW2_BATCH_A: Record<string, string[]> = {
  plain: [
    'Bethany Okonjo', 'DARIUS WHITFIELD', 'Ingrid Halvorsen', 'Marisol Quintanilla', 'TREVON ABERCROMBIE', 'Siobhan Gallagher', 'Kwabena Agyeman',
    'Yusuf Demirtas', 'PRIYANKA VENKATARAMAN', 'Lorenzo Castellano', 'Hyun-woo Baek', 'Nadia Petrenko', 'Callum Fraser', 'ESPERANZA VILLASENOR',
    'Tobias Lindgren', 'Aaliyah Brathwaite', 'Mehmet Yildirim', 'Chidinma Nwachukwu', 'Rosalind Pemberton', 'GUSTAVO ECHEVERRIA',
  ],
  lastFirst: [
    'WHITFIELD, DARIUS L', 'HALVORSEN INGRID', 'QUINTANILLA, MARISOL', 'ABERCROMBIE TREVON D', 'GALLAGHER, SIOBHAN M.', 'AGYEMAN KWABENA',
    'DEMIRTAS, YUSUF', 'VENKATARAMAN, PRIYANKA', 'CASTELLANO LORENZO A', 'BAEK, HYUN-WOO', 'PETRENKO NADIA', 'FRASER, CALLUM J',
    'VILLASENOR ESPERANZA', 'LINDGREN, TOBIAS', 'BRATHWAITE AALIYAH K', 'YILDIRIM, MEHMET', 'NWACHUKWU CHIDINMA', 'PEMBERTON, ROSALIND E',
    'ECHEVERRIA GUSTAVO', 'OKONJO, BETHANY',
  ],
  initials: [
    'D. L. Whitfield', 'I Halvorsen', 'M.Q. Quintanilla', 'T D ABERCROMBIE', 'S. M. Gallagher', 'K. Agyeman', 'Y DEMIRTAS', 'P.V. Raman',
    'L A Castellano', 'H W BAEK', 'N. Petrenko', 'C J FRASER', 'E. Villasenor', 'T. L.', 'A K B', 'MEHMET Y.', 'CHIDINMA N', 'R. E. P.',
    'G ECHEVERRIA M', 'B. O.',
  ],
  suffixHonorific: [
    'Darius Whitfield Jr', 'INGRID HALVORSEN III', 'Mr Callum Fraser', 'MRS. MARISOL QUINTANILLA', 'Dr. Priyanka Venkataraman', 'REV TREVON ABERCROMBIE SR',
    'Ms Siobhan Gallagher', 'Elder Kwabena Agyeman', 'Hon. Lorenzo Castellano', 'Sgt Tobias Lindgren', 'Miss Aaliyah Brathwaite', 'Prof. Mehmet Yildirim',
    'Deacon Gustavo Echeverria', 'Sir Callum Fraser II', 'Dame Rosalind Pemberton', 'Lt Col Yusuf Demirtas', 'Mx Nadia Petrenko', 'Madam Chidinma Nwachukwu',
    'Chief Kwabena Agyeman', 'Imam Yusuf Demirtas', 'Rabbi Avi Goldfarb', 'Senator Maria Cantwell', 'Officer Dale Brennan', 'Coach Ray Lunsford',
    'Atty Bethany Okonjo', 'Engr Chidinma Nwachukwu', 'Arq. Gustavo Echeverria', 'Lic. Marisol Quintanilla', 'Sra Esperanza Villasenor', 'Don Lorenzo Castellano',
  ],
  nonEnglish: [
    'Oluwatobiloba Adegbite', 'Nguyễn Thị Bích Ngọc', 'Zhang Xiuying', 'Park Seo-yeon', 'Takumi Fujimoto', 'Aarav Deshpande', 'Fatima Al-Zahrani',
    'Dmitri Volkonsky', 'Agnieszka Wiśniewska', 'Björn Sigurðsson', 'Tevita Fifita', 'Kalani Kahananui', 'Itzel Xicotencatl', 'Thandiwe Mthembu',
    'Tigist Gebremariam', 'Abdirahman Farah', 'Seung-hoon Rhee', 'Siosaia Taufa', 'Nizhoni Begay', 'Wiremu Tamihana', 'Søren Kjærgaard',
    'Łukasz Zieliński', 'Çağlar Öztürk', 'Đặng Văn Hùng', 'Sinéad Ní Bhriain', 'Guðrún Jónsdóttir', 'Anahí Chuquimamani', 'Rahim Uddin',
    'Sukhjinder Dhaliwal', 'Phouthone Sengsavang', 'Lhakpa Sherpa', 'Mele Tuipulotu', 'Yerlan Nurmagambetov', 'Arnav Bhattacharyya', 'Ebere Onwuachi',
    'Nokuthula Zwane', 'Hye-jin Seong', 'Thuy-Linh Truong', 'Jean-Baptiste Kabongo', 'María José Etxeberria',
  ],
  tradeWordInLists: [
    'Wendy Church', 'Marcus Temple', 'Olivia Law', 'Gerald Parish', 'Nina Bar', 'Hector Lodge', 'Paula Kitchen', 'Derek Bank', 'Tina Market',
    'Oscar Grill', 'Lena Inn', 'Felix Garage', 'Rita Service', 'Glen Store', 'Ivy College', 'Ned Studio', 'Carla Burger', 'Troy Coffee',
    'Dana Arena', 'Leah Brothers', 'Wade Union', 'Sara Council', 'Kofi Beauty', 'Elena Wines', 'Hugo Solar', 'Mona Deli', 'Ruth Salon',
    'Seth Bureau', 'Lucia Pizza', 'Amos Baptist', 'Gina Buffet', 'Cole Diner', 'Tara Fence', 'Ross League', 'Jill School', 'Kurt Coop',
    'Faye Hardware', 'Noel Gallery', 'Vera Sisters', 'Dean Tavern', 'Opal Spa', 'Rex Shack', 'CHURCH WENDY', 'TEMPLE MARCUS A', 'LAW OLIVIA',
    'PARISH GERALD T', 'KITCHEN PAULA', 'BANK DEREK', 'Mason Carpenter', 'Hunter Fisher', 'Cooper Mason', 'Taylor Baker', 'Carter Cook',
    'Parker Hall', 'Dean Bishop', 'Marshall Hill', 'Chase Banks', 'Grant Wood', 'Reed Stone', 'Brooks Fields',
  ],
  tradeWordNotInLists: [
    // real surnames or given names that are business words in neither name list
    'Bill Center', 'Mary Center', 'Tom Centers', 'James Cooling', 'Maria Gas', 'Tamika Nails', 'John Office', 'Ann Hospital', 'Pierre Tours',
    'Dimitrov Spas', 'Spas Dimitrov', 'Media Benjamin', 'Dewi Media', 'Walt Pest', 'Earl County', 'Roy Borough', 'Kevin Wings', 'Linda Pools',
    'CENTER WILLIAM R', 'CENTER, BILL', 'NAILS TAMIKA', 'COOLING JAMES', 'Peter Design', 'Anna Capital', 'Sam Supply', 'Lou Motors',
    'Chandra Wickramasinghe', 'Health Ledger', 'Brandon Florist', 'Kim Tile', 'Joe Club', 'Sandra Travel', 'Gary Storage', 'Ellen Signs',
    'Al Auto', 'Bo Gym', 'Jo Shop', 'Ty Pub', 'Li Foods', 'An Dental', 'Ed Energy', 'Min Sushi', 'Yu Ramen', 'Hai Noodle',
    
    // weak legal forms and credentials after a name that is not person-shaped to the classifier
    'John Silver PA', 'Adam Driver PA', 'Denver Smith PA', 'Mary Beach PA', 'Tom Quick PA', 'Ann Garden P.A.', 'Royal Johnson PA', 'Star Jones PA',
    'Mercy Okafor PA', 'River Johnson PA', 'Jane Shore PC', 'Bay Nguyen PA', 'Liberty Adams PA', 'Jersey Brown CO', 'SMITH JOHN L P',
    // descriptive-word given name + ambiguous-word surname
    'River Church', 'Denver Temple', 'Star Law', 'Royal Parish', 'Blue Kitchen', 'Mercy Lodge', 'Liberty Bank', 'Happy Bar', 'Lucky Store',
    'Meadow Law', 'Canyon Church', 'Shiloh Temple', 'Magnolia Parish', 'Lotus Law', 'Cedar Lodge', 'Ridge Law', 'Memphis Church', 'Bronx Law',
    'Montana Parish', 'Nevada Temple', 'Florida Church', 'America Parish', 'Tennessee Law', 'Saint Lodge', 'Sunshine Parish', 'Rainbow Church',
    'Urban Law', 'Bay Temple', 'Texas Law', 'Legacy Church', 'LAW RIVER', 'CHURCH DENVER', 'TEMPLE STAR', 'Beauty Garden', 'Beauty Bay',
    'Beauty Shore', 'Kai Blue Church', 'Zendaya Star Law', 'Saoirse River Temple',
  ],
  idTokens: [
    'LIC 4521 DARIUS WHITFIELD', 'DARIUS LIC#4521 WHITFIELD', 'DARIUS WHITFIELD LIC 4521', '#33 INGRID HALVORSEN', 'INGRID #33 HALVORSEN',
    'INGRID HALVORSEN #33', 'UNIT 5 CALLUM FRASER', 'CALLUM FRASER UNIT 5', 'CALLUM FRASER APT 12B', 'APT 12B CALLUM FRASER', 'STE 200 NADIA PETRENKO',
    'NADIA PETRENKO STE 200', 'NADIA PETRENKO SUITE 200', 'ID 99812 TOBIAS LINDGREN', 'TOBIAS LINDGREN ID 99812', 'TOBIAS 99812 LINDGREN',
    'CBC1258899 MEHMET YILDIRIM', 'MEHMET CBC1258899 YILDIRIM', 'MEHMET YILDIRIM CBC1258899', 'ROC 33221 GUSTAVO ECHEVERRIA', 'GUSTAVO ECHEVERRIA ROC33221',
    'TACLA0012 ROSALIND PEMBERTON', 'ROSALIND PEMBERTON M-4412', 'M-4412 ROSALIND PEMBERTON', 'BETHANY OKONJO NO. 7', 'NO 7 BETHANY OKONJO',
    'BETHANY OKONJO BLDG 2', 'BETHANY OKONJO BUILDING 2', 'BETHANY OKONJO OFFICE 3', 'BETHANY OKONJO SHOP 4', 'BETHANY OKONJO FLOOR 2',
    'BETHANY OKONJO ROOM 14', 'BETHANY OKONJO LOT 9', 'BETHANY OKONJO PERMIT 2024-0091', 'BETHANY OKONJO LICENSE 0091', 'BETHANY OKONJO REG 0091',
    'BETHANY OKONJO 123 CENTER ST', 'CALLUM FRASER 1200 UNIVERSITY AVE', 'NADIA PETRENKO 500 COUNTY ROAD 12', 'TOBIAS LINDGREN 88 HOSPITAL DR',
    'INGRID HALVORSEN 45 ACADEMY ST', 'DARIUS WHITFIELD 9 CLUB DR APT 4', 'MEHMET YILDIRIM 310 CAPITAL BLVD', 'GUSTAVO ECHEVERRIA 77 LIBRARY LN',
    'ROSALIND PEMBERTON 15 ENTERPRISE DR', 'SIOBHAN GALLAGHER 2 CORPORATE DR', 'KWABENA AGYEMAN 61 MEDICAL CENTER DR', 'YUSUF DEMIRTAS 4 INTERNATIONAL BLVD',
    'MARISOL QUINTANILLA 900 STADIUM DR', 'AALIYAH BRATHWAITE 12 MUSEUM RD', 'LORENZO CASTELLANO 3 TECHNOLOGY DR', 'CHIDINMA NWACHUKWU 18 OFFICE PARK',
    'DARIUS WHITFIELD 12 MAIN ST', 'INGRID HALVORSEN 44 CHURCH ST', 'CALLUM FRASER PO BOX 12', 'NADIA PETRENKO 7 MARKET ST', 'TOBIAS LINDGREN 5 SCHOOL ST',
  ],
  couples: [
    'DARIUS & KEISHA WHITFIELD', 'Ingrid and Lars Halvorsen', 'CALLUM + FIONA FRASER', 'WHITFIELD DARIUS & KEISHA', 'HALVORSEN, INGRID & LARS',
    'Mr and Mrs Callum Fraser', 'MR&MS ZELENSKYY', 'DR&MS HALVORSEN', 'AL&JO ZELENSKYY', 'ED&JO KRZYZEWSKI', 'MR&MRS PEMBERTON', 'D&K WHITFIELD',
    'DARIUS/KEISHA WHITFIELD', 'NADIA PETRENKO & TOBIAS LINDGREN', 'PETRENKO NADIA AND LINDGREN TOBIAS', 'THE WHITFIELDS', 'THE HALVORSEN FAMILY',
    'DARIUS WHITFIELD AND WIFE', 'INGRID HALVORSEN & HUSBAND', 'CALLUM FRASER AND SON', 'MARY JONES & SON', 'NADIA PETRENKO & DAUGHTERS',
    'WHITFIELD DARIUS & SONS', 'DARIUS WHITFIELD AND BROTHERS', 'INGRID HALVORSEN AND PARTNERS', 'MEHMET & AYSE YILDIRIM H/W', 'YILDIRIM MEHMET JTWROS',
    'GUSTAVO ECHEVERRIA Y MARISOL QUINTANILLA', 'FRASER CALLUM & FIONA JT TEN', 'OKONJO BETHANY & AGYEMAN KWABENA',
  ],
  dbaPerson: [
    'ACME ROOFING DBA DARIUS WHITFIELD', 'APEX LLC D/B/A INGRID HALVORSEN', 'DARIUS WHITFIELD DBA DARIUS WHITFIELD', 'WHITFIELD DARIUS DBA D WHITFIELD',
    'INGRID HALVORSEN T/A INGRID', 'CALLUM FRASER TRADING AS CALLUM FRASER', 'NADIA PETRENKO DOING BUSINESS AS NADIA P', 'DARIUS WHITFIELD D B A KEISHA WHITFIELD',
    'DARIUS WHITFIELD DBA: KEISHA WHITFIELD', 'DARIUS WHITFIELD (DBA) KEISHA WHITFIELD', 'DARIUS WHITFIELD O/A KEISHA WHITFIELD', 'DARIUS WHITFIELD FKA DARIUS JONES',
    'INGRID HALVORSEN F/K/A INGRID BERG', 'INGRID HALVORSEN NKA INGRID BERG', 'INGRID HALVORSEN NEE BERG', 'CALLUM FRASER FORMERLY CALLUM REID',
    'DBA DARIUS WHITFIELD', 'D/B/A INGRID HALVORSEN', 'APEX SERVICES LLC DBA CALLUM', 'APEX SERVICES DBA FRASER, CALLUM',
  ],
  titles: [
    'DARIUS WHITFIELD QUALIFIER', 'INGRID HALVORSEN LICENSEE', 'CALLUM FRASER PROPRIETOR', 'NADIA PETRENKO SOLE PROPRIETOR', 'TOBIAS LINDGREN MANAGING MEMBER',
    'MEHMET YILDIRIM REGISTERED AGENT', 'GUSTAVO ECHEVERRIA ESTIMATOR', 'ROSALIND PEMBERTON PROJECT MANAGER', 'BETHANY OKONJO SUPERINTENDENT',
    'SIOBHAN GALLAGHER MASTER PLUMBER', 'KWABENA AGYEMAN MASTER ELECTRICIAN', 'YUSUF DEMIRTAS JOURNEYMAN', 'MARISOL QUINTANILLA BOOKKEEPER',
    'AALIYAH BRATHWAITE RECEPTIONIST', 'LORENZO CASTELLANO HEAD CHEF', 'CHIDINMA NWACHUKWU PHARMACIST', 'DARIUS WHITFIELD GENERAL MANAGER',
    'INGRID HALVORSEN FOOD MANAGER', 'CALLUM FRASER CERTIFIED FOOD MANAGER', 'NADIA PETRENKO PERSON IN CHARGE', 'TOBIAS LINDGREN PIC',
    'MEHMET YILDIRIM KITCHEN MANAGER', 'GUSTAVO ECHEVERRIA STORE MANAGER', 'ROSALIND PEMBERTON DENTAL HYGIENIST', 'BETHANY OKONJO BUILDING INSPECTOR',
    'SIOBHAN GALLAGHER PROPERTY MANAGER', 'KWABENA AGYEMAN REAL ESTATE AGENT', 'YUSUF DEMIRTAS INSURANCE AGENT', 'MARISOL QUINTANILLA HEALTH INSPECTOR',
    'AALIYAH BRATHWAITE OFFICE', 'PRESIDENT DARIUS WHITFIELD', 'MANAGER INGRID HALVORSEN', 'CONTRACTOR CALLUM FRASER', 'ARCHITECT NADIA PETRENKO',
    'ENGINEER OF RECORD TOBIAS LINDGREN', 'PLUMBER MEHMET YILDIRIM', 'AGENT GUSTAVO ECHEVERRIA', 'DARIUS WHITFIELD PE', 'INGRID HALVORSEN AIA',
    'CALLUM FRASER RA LEED AP', 'NADIA PETRENKO SE', 'TOBIAS LINDGREN, P.E., S.E.', 'DARIUS WHITFIELD ARCHITECTURAL DESIGNER', 'INGRID HALVORSEN STRUCTURAL ENGINEER',
    'CALLUM FRASER DESIGN PROFESSIONAL', 'NADIA PETRENKO SELF CERT ARCHITECT',
  ],
  quotesThe: [
    '"Darius Whitfield"', "'Ingrid Halvorsen'", '«Callum Fraser»', 'THE DARIUS WHITFIELD', 'THE INGRID', 'DARIUS "DEE" WHITFIELD', 'THE LATE CALLUM FRASER',
    '`Nadia Petrenko`', '**TOBIAS LINDGREN**', '--MEHMET YILDIRIM--', 'THE FRASERS', 'THE PETRENKO RESIDENCE', 'THE LINDGREN HOME', 'WHITFIELD RESIDENCE',
    'HALVORSEN HOUSEHOLD', 'FRASER HOME', 'RESIDENCE OF NADIA PETRENKO', 'HOME OF TOBIAS LINDGREN', 'CASA DE MARISOL QUINTANILLA', 'THE YILDIRIM FAMILY HOME',
  ],
  trustsRoles: [
    'DARIUS WHITFIELD TRUST', 'WHITFIELD FAMILY TR', 'INGRID HALVORSEN REV TRUST', 'HALVORSEN INGRID TRUSTEE', 'CALLUM FRASER LIV TR', 'FRASER CALLUM ET UX',
    'PETRENKO NADIA ETUX', 'LINDGREN TOBIAS ET VIR', 'YILDIRIM MEHMET ETAL', 'ECHEVERRIA GUSTAVO ET AL', 'ESTATE OF ROSALIND PEMBERTON', 'PEMBERTON ROSALIND EST',
    'BETHANY OKONJO AKA BETH OKONJO', 'OKONJO BETHANY A/K/A BETH', 'C/O SIOBHAN GALLAGHER', 'GALLAGHER SIOBHAN C/O', 'ATTN KWABENA AGYEMAN', 'ATTN: YUSUF',
    'FBO MARISOL QUINTANILLA', 'QUINTANILLA MARISOL FBO', 'AALIYAH BRATHWAITE IRA', 'LORENZO CASTELLANO 401K', 'CHIDINMA NWACHUKWU UTMA', 'DARIUS WHITFIELD TOD',
    'INGRID HALVORSEN POD KEISHA', 'CALLUM FRASER JT TEN', 'NADIA PETRENKO TEN COM', 'TOBIAS LINDGREN LE', 'MEHMET YILDIRIM SURVIVORSHIP', 'GUSTAVO ECHEVERRIA % MARISOL',
    'ROSALIND PEMBERTON SUCC TTEE', 'PEMBERTON 2019 TRUST', 'WHITFIELD IRREV TR', 'DARIUS WHITFIELD MEMORIAL', 'INGRID HALVORSEN SCHOLARSHIP',
    'LESSEE CALLUM FRASER', 'CALLUM FRASER LESSEE', 'TENANT NADIA', 'NADIA PETRENKO RENTER', 'TOBIAS LINDGREN BUYER', 'MEHMET YILDIRIM SELLER',
    'GUSTAVO ECHEVERRIA COMPLAINANT', 'ROSALIND PEMBERTON CALLER', 'BETHANY OKONJO REQUESTOR', 'SIOBHAN GALLAGHER NEIGHBOR', 'KWABENA AGYEMAN PERMITTEE',
  ],
  caseSpacePunct: [
    'darius whitfield', 'dArIuS wHiTfIeLd', '  Ingrid   Halvorsen  ', 'Callum\tFraser', 'Nadia\nPetrenko', 'TOBIAS,LINDGREN', 'Mehmet.Yildirim', 'Gustavo_Echeverria',
    'ROSALIND-PEMBERTON', 'Bethany  Okonjo.', 'siobhan gallagher,', '..Kwabena Agyeman..', 'YUSUF  DEMIRTAS ;', 'marisol quintanilla!!', '¿Aaliyah Brathwaite?',
    'Lorenzo,Castellano,', 'CHIDINMA/NWACHUKWU', 'D A R I U S  W H I T F I E L D', 'DariusWhitfield', 'ingridhalvorsen', 'Fraser,Callum', 'PETRENKO;NADIA',
    'lindgren | tobias', 'yildirim : mehmet', 'ECHEVERRIA\\GUSTAVO', '(Rosalind Pemberton)', '[Bethany Okonjo]', '{Siobhan Gallagher}', 'Kwabena (Kojo) Agyeman',
    'Yusuf Demirtas (cell)', 'M@risol Quintanilla', 'A.a.l.i.y.a.h Brathwaite',
  ],
  unicode: [
    'Јоhn Smіth', 'JOHN SMITΗ', 'Mаry Jоnes', 'Ｊｏｈｎ Ｓｍｉｔｈ', 'John​Smith', 'John Smith', 'Jöhn Smïth', 'JOHN‑PAUL SMITH',
    'Mаry Blue Church', 'Jоhn Royal Law', 'ЈОНN ЅМІТН ROOFING', 'Mаry Church', 'José Ñuñez Law', 'Renée Zoë Brontë', 'Þórr Æsir', 'Ｍａｒｙ Jones',
    'Mary Jones‮', '﻿Mary Jones', 'Mária López', 'Ⅿary Ⅼopez',
  ],
  shortLong: [
    'Bo Li', 'Xi Yu', 'Al Ng', 'Jo Wu', 'Ed Oh', 'Ty Vu', 'An Do', 'Le Ma', 'Yi He', 'Bo',
    'Hubert Blaine Wolfeschlegelsteinhausenbergerdorff', 'Juan Pablo Fernando Alejandro Montoya de la Rosa Ramirez y Gutierrez',
    'Maria de los Angeles Guadalupe Villanueva Hinojosa de Echeverria', 'Adolph Blaine Charles David Earl Frederick Gerald Hubert Irvin John Kenneth Lloyd Martin',
    'Abdul Rahman bin Abdul Aziz bin Abdullah Al-Sheikh', 'Sri Lakshmi Narasimha Venkata Subrahmanya Sastry Vadlamani', 'Uvuvwevwevwe Onyetenyevwe Ugwemubwem Ossas',
    'Pablo Diego José Francisco de Paula Juan Nepomuceno Ruiz Picasso', 'X Æ A-12 Musk', 'Mary-Jane Anne-Marie Smith-Jones-Brown',
  ],
};

export const REVIEW2_BATCH_B: Record<string, string[]> = {
  initialsLegal: ['PEMBERTON L P', 'Okonjo, L.P.', 'QUINTANILLA P A', 'Venkataraman, P.A.', 'HALVORSEN P C', 'Agyeman, P.C.', 'ECHEVERRIA C O', 'Whitfield P.A.',
    'NWACHUKWU, PA', 'Brathwaite PA', 'Lindgren PC', 'Castellano Co', 'Demirtas, Co.', 'Yildirim Ltd', 'Petrenko Inc', 'Gallagher LLC', 'Zelenskyy Corp', 'Okonjo Company',
    'D L Whitfield PA', 'Whitfield D L PA', 'I. Halvorsen, P.A.', 'B Okonjo PC'],
  occupation: ['JOHN SMITH DENTAL HYGIENIST', 'MARY JONES NURSING STUDENT', 'ROBERT BROWN PLUMBING APPRENTICE', 'LINDA DAVIS HOSPITAL VOLUNTEER', 'JAMES WILSON CONSTRUCTION WORKER',
    'DAVID MILLER CONSTRUCTION LABORER', 'SARAH TAYLOR MEDICAL STUDENT', 'KEVIN WHITE AUTO SALESMAN', 'MIKE JONES ROOFING HELPER', 'TOM CLARK ELECTRICAL APPRENTICE',
    'ANNA LEE DENTAL PATIENT', 'PAUL YOUNG HOTEL GUEST', 'RUTH KING PHARMACY CUSTOMER', 'CARL HALL RESTAURANT WORKER', 'JOAN ADAMS DAYCARE PROVIDER', 'MARIA LOPEZ HOME DAYCARE',
    'MARIA LOPEZ FAMILY DAYCARE HOME', 'TAMIKA JOHNSON IN-HOME CHILDCARE', 'JOSE GARCIA FOOD VENDOR', 'WEI CHEN FOOD CART', 'ROSA PEREZ TAMALE VENDOR', 'ALI HASSAN ICE CREAM TRUCK',
    'JOHN SMITH RENTAL', 'MARY JONES RENTAL PROPERTY', 'JOHN SMITH PROPERTY', 'MARY JONES HOME', 'JOHN SMITH RESIDENCE REMODELING', 'SMITH RESIDENCE ROOFING',
    'JOHN SMITH KITCHEN REMODELING', 'MARY JONES BATHROOM RENOVATION', 'JOHN SMITH GARAGE CONSTRUCTION', 'JOHN SMITH POOL', 'JOHN SMITH FENCE', 'MARY JONES DECK',
    'JOHN SMITH SOLAR', 'JOHN SMITH SOLAR INSTALLATION', 'MARY JONES HVAC REPLACEMENT', 'JOHN SMITH ROOFING', 'Mary Jones Plumbing LLC'],
  addressish: ['JOHN SMITH 123 CENTER ST', 'MARY JONES 1200 UNIVERSITY AVE APT 4', 'JOHN SMITH 4521 MEDICAL DR CHICAGO IL 60601', 'SMITH JOHN 77 COUNTY RD 12',
    'MARY JONES, 15 ENTERPRISE DR', 'JOHN SMITH - 9 CLUB DR', 'JOHN SMITH 500 W CENTER', 'MARY JONES CENTER ST', 'JOHN SMITH UNIVERSITY PARK', 'MARY JONES HOSPITAL RD',
    'JOHN SMITH GROUP HOME', 'JOHN SMITH @ 12 MAIN ST', 'JOHN SMITH 12 MAIN ST', 'MARY JONES 44 OAK AVE'],
  glued: ['MR&MS OKONJO', 'MR&MRS ZELENSKYY', 'DR&MRS HALVORSEN', 'JO&ED PEMBERTON', 'BO&LI QUINTANILLA', 'TY&AL WHITFIELD', 'MS&MR AGYEMAN', 'J&M OKONJO', 'JR&SR ZELENSKYY',
    'AL&JO SMITH', 'MR&MS SMITH'],
  misc: ['OFFICE OF SMITH', 'OFFICE OF JOHN', 'TOWN OF JOHN SMITH', 'PEOPLE OF MARY JONES', 'CITY OF AUSTIN JOHN SMITH', 'DEPARTMENT OF JOHN', 'SCHOOL OF MARY',
    'JOHN SMITH UNITED STATES', 'JOHN SMITH REAL ESTATE', 'JOHN SMITH HOME IMPROVEMENT', 'MARY JONES TREE SERVICE', 'JOHN SMITH GENERAL CONTRACTOR', 'JOHN SMITH & CO',
    'JOHN SMITH AND COMPANY', 'JOHN SMITH & ASSOCIATES', 'JOHN SMITH INC', 'JOHN SMITH LLC', 'Mary Jones LLC', 'J SMITH LLC', 'SMITH, JOHN LLC', 'SMITH JOHN A LLC',
    'JOHN SMITH LIMITED', 'JOHN SMITH LP', 'JOHN SMITH PLLC', 'JOHN SMITH SERVICES', 'JOHN SMITH ENTERPRISES', 'JOHN SMITH PROPERTIES', 'JOHN SMITH HOLDINGS',
    'JOHN SMITH INVESTMENTS', 'JOHN SMITH FOUNDATION', 'JOHN SMITH MINISTRIES', 'JOHN SMITH MD PA', 'JOHN SMITH DDS PC', 'JOHN SMITH MD INC', 'JOHN SMITH ATTORNEY AT LAW',
    'LAW OFFICES OF JOHN SMITH PC', 'JOHN SMITH CPA PC', 'JOHN SMITH, ESQ., P.C.', 'JOHN SMITH MD HEALTH', 'DR JOHN SMITH DENTAL', 'DR. MARY JONES FAMILY DENTISTRY'],
};

/**
 * The only review2 strings (and one FIX-C flip) with a non-null result, and why: a company part with no word of the person (the review's
 * own "correct" class), a non-person probe, and a surname followed by a strong legal form, which R6 allows ("Okonjo Zelenskyy LLC").
 */
export const REVIEW2_ALLOWED: Record<string, string> = {
  'Health Ledger': 'Health Ledger',
  'ACME ROOFING DBA DARIUS WHITFIELD': 'ACME ROOFING',
  // FIX-E follow-up flip: 'APEX LLC D/B/A INGRID HALVORSEN' -> null (a part of a joined value needs two non-legal-form words)
  'APEX SERVICES LLC DBA CALLUM': 'APEX SERVICES LLC',
  'APEX SERVICES DBA FRASER, CALLUM': 'APEX SERVICES',
  'Yildirim Ltd': 'Yildirim Ltd',
  // FIX-E flip: 'Petrenko Inc' -> null ("PETR" is a listed given name glued to 4+ letters, R10)
  'Gallagher LLC': 'Gallagher LLC',
  'Zelenskyy Corp': 'Zelenskyy Corp',
  // FIX-C flip: was in NEW_PERSON_TRAPS; FIX-E flip back: 'SMITH, INC.' -> null ("smith" is in the 5,149 given names of review3)
};
