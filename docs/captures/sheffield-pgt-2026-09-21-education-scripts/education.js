var SELECT_INSTITUTION = "Select institution...";
var NOT_IN_LIST = "Not in list";
var NO_RESULTS = "No results found";
var STILL_WAITING_FOR_GRADE = "Still waiting for grade";
var INITIAL_SEARCH_BROWSE_TEXT = "Search for an institution...";

function XMLDoc()
{
	var me = this;
	var req = null;
	if (window.XMLHttpRequest) {
		try
		{
			req = new XMLHttpRequest();
		} catch(e) {
			req = null;
		}
	} else if (window.ActiveXObject) {
		try {
			req = new ActiveXObject("Msxml2.XMLHTTP");
		} catch (e) {
			try
			{
				req = new ActiveXObject("Microsoft.XMLHTTP");
			} catch (e) {
				req = null;
			}
		}
	}

	this.request = req;

	this.loadXMLDoc = function(url, loadHandler)
	{
		if (this.request) {
			var randomNum = Math.floor(Math.random()*10000000000);
			url = url + "&noCache=" + randomNum;

			this.request.open("POST", url, true);
			this.request.onreadystatechange = function() { loadHandler(me) };
			this.request.setRequestHeader("Content-Type", "text/xml");
			this.request.send(null);
		}
	};
}


function handleSubjectSearchEnterPressed()
{
	if(window.event && window.event.keyCode == 13)
	{
		searchSubjects();
		return false;
	}
	else return true;
}

function degreeChanged()
{
	var degree = document.getElementById("degree").value;
	if (degree.length == 0)
		document.getElementById("degreeDiv").style.display="block";
	else
		document.getElementById("degreeDiv").style.display="none";
}

/** Called by tom-select dropdown */
function loadInstitutionSearch(query, callback) {
	const country = document.getElementById('institutionCountry').value;
	searchInstitutions(query, country, erasmusStudyAbroad)
		.then(data => {
			callback([
				...data,
				{displayName: NOT_IN_LIST, code: NOT_IN_LIST}
			]);
		})
		.catch(e => {
			console.error("Error loading institutions", e);
			callback();
			alert('Failed to search institutions. Please try again.');
		});
}

function institutionChanged() {
	const selectedInstitution = document.getElementById("institution").value;
	const country = document.getElementById('institutionCountry').value;
	const unlisted = selectedInstitution === NOT_IN_LIST;

	// India warning
	if (document.getElementById("indiaWarning") !== null)
		document.getElementById("indiaWarning").style.display = country === 'INDIA' ? 'block' : 'none';

	// Unlisted options
	document.getElementById("unlistedInstitutionDiv").style.display = unlisted ? 'block' : 'none';

	loadGradingSystems();
}

function searchInstitutions(searchQuery, country, studyAbroad = false) {
	const params = new URLSearchParams({
		name: searchQuery,
		studyAbroad: studyAbroad,
		...(country && {country: country})
	});
	return fetch(`./ajax/institution/search.app?${params}`)
		.then(res => {
			if (!res.ok) throw new Error("Received non-OK response: " + res.status);
			return res.json();
		});
}

function searchSubjects()
{
	var searchString = document.getElementById("subjectSearch").value;
	if (searchString.length == 0) alert('Please enter a search');
	else
	{
		var returnFunction = eval("showSubjects");
		var institutionRequest = new XMLDoc();
		institutionRequest.loadXMLDoc("searchSubjects.do?search=" + searchString, returnFunction);

		document.getElementById("subjectSearchLoader").style.display="inline";
		document.getElementById("subjectSearchButton").disabled=true;
		document.getElementById("subjectSearch").disabled=true;
		var selectElement = document.getElementById("subject");
		selectElement.length = 0;
		selectElement.options[0] = new Option("Searching...","",false,false);
		selectElement.disabled = true;
	}
}
function showSubjects(req)
{
	enableSubjects();
	var selectElement = document.getElementById("subject");
	showSubjectArray(req, selectElement);
}

function enableSubjects()
{
	document.getElementById("subjectSearchLoader").style.display="none";
	document.getElementById("subjectSearchButton").disabled=false;
	document.getElementById("subjectSearch").disabled=false;
	document.getElementById("subject").disabled=false;
}

var currentArrayNum = 0;
var arrayData = new Array();
var currentSelectElement = new Array();
var lastOptionNumber = new Array();
function showInstitutionArray(req, selectElement)
{
	req = req.request;
	if (req.readyState == 4)
	{
		if (req.status == 200)
		{
			var responseText = req.responseText;
			var resultArray = eval(responseText);


			//	alert("responseText Evaluated");

			selectElement.length = 0;

			//Cancel any updates on the same list
			for (var i=0; i<currentSelectElement.length; i++)
			{
				if (currentSelectElement[i].id == selectElement.id)
				{
					//alert("Cancelling list update for: " + currentSelectElement[i].id);
					arrayData[i] = new Array(); //empty array so end of list will trigger
				}
			}

			if (resultArray.length > 1000)
			{
				//Split the update into multiple small parts to prevent the browser locking up
				lastOptionNumber[currentArrayNum] = 0;
				currentSelectElement[currentArrayNum] = selectElement;
				arrayData[currentArrayNum] = resultArray;

				addOptionsToList(currentArrayNum);

				currentArrayNum++; //Put each request in a different array position so results don't overwrite each other


			}
			else
			{
				for (var i=0; i<resultArray.length; i+=2)
				{
					var optn = document.createElement("OPTION");
					optn.text = resultArray[i];
					optn.value = resultArray[i+1];
					selectElement.options.add(optn);
				}
				document.getElementById("institutionSearchLoader").style.display="none";
			}
		} else {
			alert("A problem occured whilst loading the institutions");
		}
	}
}
function addOptionsToList(arrayNum)
{
	var endAdding = lastOptionNumber[arrayNum] + 100;
	if (endAdding > arrayData[arrayNum].length) endAdding = arrayData[arrayNum].length;

	//alert("Adding options: " + lastOptionNumber + " to " + endAdding);

	for (var i=lastOptionNumber[arrayNum]; i<endAdding; i+=2)
	{
		var optn = document.createElement("OPTION");
		optn.text = arrayData[arrayNum][i];
		optn.value = arrayData[arrayNum][i+1];
		currentSelectElement[arrayNum].options.add(optn);

		lastOptionNumber[arrayNum]+=2;

		//selectElement.options[i/2] = new Option(arrayData[i],arrayData[i+1],false,false);
	}
	if (lastOptionNumber[arrayNum] < arrayData[arrayNum].length)
	{
		window.setTimeout("addOptionsToList("+arrayNum+")",50);
	} else {
		document.getElementById("institutionSearchLoader").style.display="none";
	}
}


function showSubjectArray(req, selectElement)
{
	req = req.request;
	if (req.readyState == 4)
	{
		if (req.status == 200)
		{
			var responseText = req.responseText;
			var arrayData = eval(responseText);

			selectElement.length = 0;

			for (var i=0; i<arrayData.length; i++)
			{
				selectElement.options[i] = new Option(arrayData[i],arrayData[i],false,false);
			}
		} else {
			alert("A problem occured whilst loading the subjects");
		}
	}
}
function subjectListChanged()
{
	var selectedSubject = document.getElementById("subject").value;
	if (selectedSubject == NOT_IN_LIST)
	{
		document.getElementById("unlistedSubjectDiv").style.display="block";
	} else {
		document.getElementById("unlistedSubjectDiv").style.display="none";
	}
}
function gradingSystemChanged()
{
	var gradingSystemsElem = document.getElementById("gradingSystems");
	var gradingSystemId = gradingSystemsElem.value;

	if (gradingSystemId == NOT_IN_LIST)
	{
		document.getElementById("unlistedGradeDiv").style.display = "inline";
		document.getElementById("gradeDiv").style.display = "none";
	} else {
		document.getElementById("unlistedGradeDiv").style.display = "none";
		document.getElementById("gradeDiv").style.display = "inline";
	}
}

function test()
{
	document.getElementById("test").innerHTML = "Test:";
}

function loadGradingSystems()
{
	var institutionCode = document.getElementById("institution").value;
	var unlistedInstitutionCountry = document.getElementById("institutionCountry").value;

	if (institutionCode != null &&
		institutionCode != SELECT_INSTITUTION &&
		institutionCode != NOT_IN_LIST &&
		institutionCode != NO_RESULTS &&
		institutionCode != INITIAL_SEARCH_BROWSE_TEXT)
	{
		document.getElementById("gradingSystemLoader").style.display="inline";

		var gradeRequest = new XMLDoc();
		gradeRequest.loadXMLDoc("getGradingSystemsForCountry.do?institutionCode=" + institutionCode, showGradingSystems);
	}
	else if (unlistedInstitutionCountry != null && unlistedInstitutionCountry.length > 0)
	{
		document.getElementById("gradingSystemLoader").style.display="inline";

		var gradeRequest = new XMLDoc();
		gradeRequest.loadXMLDoc("getGradingSystemsForCountry.do?country=" + unlistedInstitutionCountry, showGradingSystems);
	}
	else
	{
		var gradingSystemsElem = document.getElementById("gradingSystems");
		gradingSystemsElem.length = 0;

		gradingSystemsElem[0] = new Option("Enter your institution to see grades","",false,false);
	}
}

function showGradingSystems(req)
{
	req = req.request;
	if (req.readyState == 4)
	{
		if (req.status == 200)
		{
			var responseText = req.responseText;
			var arrayData = eval(responseText);

			//document.getElementById("debug").innerHTML = responseText;
			document.getElementById("gradingSystemLoader").style.display="none";

			var gradingSystemsElem = document.getElementById("gradingSystems");
			const prevSelection = gradingSystemsElem.value;
			gradingSystemsElem.length = 0;

			for (var i=0; i<arrayData.length; i+=2)
			{
				const code = arrayData[i+1];
				gradingSystemsElem.options[i/2] = new Option(arrayData[i], code,false,code === prevSelection);
			}
		} else {
			alert("A problem occured whilst loading the grading systems");
		}

		endDateChanged();
	}
}


function loadGrades()
{
	var gradingSystemsElem = document.getElementById("gradingSystems");
	var gradingSystemId = gradingSystemsElem.value;

	gradingSystemChanged();

	if (gradingSystemId == null || gradingSystemId == NOT_IN_LIST ||
		gradingSystemId.length == 0)
	{
		var gradesElem = document.getElementById("grades");
		gradesElem.length = 0;
		gradesElem[0] = new Option("","",false,false);

		if (gradingSystemId == NOT_IN_LIST)
		{
			document.getElementById("gradeDiv").style.display="none";
		}
	}
	else
	{
		document.getElementById("gradeDiv").style.display="inline";
		document.getElementById("gradeLoader").style.display="inline";

		var gradeRequest = new XMLDoc();
		gradeRequest.loadXMLDoc("getGradesForSystem.do?gradingSystemId=" + gradingSystemId, showGrades);
	}
}

function showGrades(req)
{
	req = req.request;
	if (req.readyState == 4)
	{
		if (req.status == 200)
		{
			var responseText = req.responseText;
			var arrayData = eval(responseText);

			//document.getElementById("debug").innerHTML = responseText;
			document.getElementById("gradeLoader").style.display="none";

			var gradesElem = document.getElementById("grades");
			gradesElem.length = 0;

			for (var i=0; i<arrayData.length; i+=1)
			{
				gradesElem.options[i] = new Option(arrayData[i],arrayData[i],false,false);
			}
		} else {
			alert("A problem occured whilst loading the grades");
		}
	}
}

function getRadioValue(radioButtonsElem)
{
	var elem;
	for( var i = 0; i < radioButtonsElem.length; i++ )
	{
		if( radioButtonsElem[i].checked == true )
		{
			elem = radioButtonsElem[i];
			return elem.value;
		}
	}
	return null;
}

var reloadGradesOnDateChange = false;
function endDateChanged(fromGrade)
{
	if (erasmusStudyAbroad)
	{
		/*document.getElementById("documentsUploadLater").style.display="block";
		document.getElementById("documentsUpload").style.display="none";
		document.getElementById("documentsUploadNoGrade").style.display="none";
		document.getElementById("preCompletionDocuments").style.display="";
		document.getElementById("stillWaitingMessage").style.display="none";
		document.getElementById("finalDocumentInfo").style.display="none";
		document.getElementById("finalDocumentsTable").style.display="none";
		*/
		return;
	}

	if (!finalDocumentsNotExpected)
	{

		var form = document.forms.namedItem("myForm");

		var month = document.getElementById("endDateMonth").selectedIndex;
		var year = document.getElementById("endDateYear").value;

		var awardMonth = document.getElementById("awardDateMonth").selectedIndex;
		var awardYear = document.getElementById("awardDateYear").value;

		if (awardYear.length == 4 && awardMonth > 0)
		{
			month = awardMonth;
			year = awardYear;
		}

		var grade = document.getElementById("grades").value;

		if (year.length == 4 && month > 0)
		{
			var today = new Date();
			var endDate = new Date(year,(month-1),1,1,0,0,0);
			var startOfMonth = new Date(today.getFullYear(),today.getMonth(),1,1,0,0,0);


			if ((endDate > startOfMonth))
			{
				document.getElementById("documentsUploadLater").style.display="block";
				document.getElementById("documentsUpload").style.display="none";
				document.getElementById("documentsUploadNoGrade").style.display="none";
				document.getElementById("preCompletionDocuments").style.display="";
				document.getElementById("stillWaitingMessage").style.display="block";
				document.getElementById("finalDocumentInfo").style.display="block";
				document.getElementById("finalDocumentsTable").style.display="block";

				reloadGradesOnDateChange = true;

				//alert(endDate.getTime() + "\n" + startOfMonth.getTime() + "\n" + (endDate.getTime()!=startOfMonth.getTime()) + " " + (!document.getElementById("gradingSystems").disabled))

				if ((!document.getElementById("gradingSystems").disabled) && (endDate.getTime()!=startOfMonth.getTime()))
				{
					document.getElementById("gradingSystems").length = 0;
					document.getElementById("gradingSystems").options[0] = new Option("Still waiting for grade","1",false,false);
					document.getElementById("grades").length = 0;
					document.getElementById("grades").options[0] = new Option("Still waiting for grade","Still waiting for grade",false,false);
				}

				document.getElementById("documentsUploadLater").style.display="block";
				document.getElementById("documentsUpload").style.display="none";

				//document.getElementById("certUpload1").style.display="none";
				//document.getElementById("certUpload2").style.display="none";
				//document.getElementById("tranUpload1").style.display="none";
				//document.getElementById("tranUpload2").style.display="none";
				document.getElementById("certTransUpload1").innerHTML="My certificate will be in English";
				document.getElementById("certTransUpload2").style.display="none";
				document.getElementById("certTransUpload3").style.display="none";
				document.getElementById("tranTransUpload1").innerHTML="My transcript will be in English";
				document.getElementById("tranTransUpload2").style.display="none";
				document.getElementById("tranTransUpload3").style.display="none";

				document.getElementById("officialCertUpload1").style.display="none";
				document.getElementById("officialCertUpload2").style.display="none";
				document.getElementById("officialTranUpload1").style.display="none";
				document.getElementById("officialTranUpload2").style.display="none";

				try
				{
					if (visitingResearch)
					{
						//No certificates required for visiting research before completion
						document.getElementById("finalCertificateNotRequired").checked = true;
						document.getElementById("finalTranscriptNotRequired").checked = true;
						document.getElementById("certificateTranslationNotRequired").checked = true;
						document.getElementById("transcriptTranslationNotRequired").checked = true;
						document.getElementById("finalDocumentInfo").style.display="none";
						document.getElementById("finalDocumentsTable").style.display="none";
					} else {
						if (getRadioValue(form.officialTranTranslStatus) == null || getRadioValue(form.officialTranTranslStatus) != 'Uploaded')
						{
							document.getElementById("officialTranTranslationUploadLaterRadio").checked = true;
						}

						if (getRadioValue(form.officialCertTranslStatus) == null || getRadioValue(form.officialCertTranslStatus) != 'Uploaded')
						{
							document.getElementById("officialCertTranslationUploadLaterRadio").checked = true;
						}
					}
				} catch (error) {}



				return;
			}
		}



		if (grade == STILL_WAITING_FOR_GRADE)
		{
			document.getElementById("documentsUploadLater").style.display="none";
			document.getElementById("documentsUpload").style.display="none";
			document.getElementById("documentsUploadNoGrade").style.display="block";
			document.getElementById("preCompletionDocuments").style.display="none";
			document.getElementById("stillWaitingMessage").style.display="block";
			document.getElementById("finalDocumentsTable").style.display="none";
			document.getElementById("finalDocumentInfo").style.display="none";

			document.getElementById("certUpload1").style.display="none";
			document.getElementById("certUpload2").style.display="none";
			document.getElementById("tranUpload1").style.display="none";
			document.getElementById("tranUpload2").style.display="none";
			document.getElementById("certTransUpload1").innerHTML="My certificate will be in English";
			document.getElementById("certTransUpload2").style.display="none";
			document.getElementById("certTransUpload3").style.display="none";
			document.getElementById("tranTransUpload1").innerHTML="My transcript will be in English";
			document.getElementById("tranTransUpload2").style.display="none";
			document.getElementById("tranTransUpload3").style.display="none";

			document.getElementById("officialCertUpload1").style.display="none";
			document.getElementById("officialCertUpload2").style.display="none";
			document.getElementById("officialTranUpload1").style.display="none";
			document.getElementById("officialTranUpload2").style.display="none";

		} else {

			document.getElementById("documentsUploadLater").style.display="none";
			document.getElementById("documentsUpload").style.display="block";
			document.getElementById("documentsUploadNoGrade").style.display="none";
			document.getElementById("preCompletionDocuments").style.display="none";
			document.getElementById("stillWaitingMessage").style.display="none";
			document.getElementById("finalDocumentInfo").style.display="none";
			document.getElementById("finalDocumentsTable").style.display="block";

			document.getElementById("certUpload1").style.display="";
			document.getElementById("certUpload2").style.display="";
			document.getElementById("tranUpload1").style.display="";
			document.getElementById("tranUpload2").style.display="";
			document.getElementById("certTransUpload1").innerHTML="My certificate is in English";
			document.getElementById("certTransUpload2").style.display="";
			document.getElementById("certTransUpload3").style.display="";
			document.getElementById("tranTransUpload1").innerHTML="My transcript is in English";
			document.getElementById("tranTransUpload2").style.display="";
			document.getElementById("tranTransUpload3").style.display="";

			document.getElementById("officialCertUpload1").style.display="";
			document.getElementById("officialCertUpload2").style.display="";
			document.getElementById("officialTranUpload1").style.display="";
			document.getElementById("officialTranUpload2").style.display="";
		}

		try
		{
			if (getRadioValue(form.certificateStatus) == null && getRadioValue(form.certificateStatus) != 'Uploaded')
			{
				document.getElementById("certificateNotRequired").checked = true;
			}

			if (getRadioValue(form.transcriptStatus) == null && getRadioValue(form.transcriptStatus) != 'Uploaded')
			{
				document.getElementById("transcriptNotRequired").checked = true;
			}
		} catch (error) {}

		if (!document.getElementById("gradingSystems").disabled)
		{
			if (reloadGradesOnDateChange && !fromGrade)
			{
				reloadGradesOnDateChange = false;
				loadGradingSystems();
			}
		}
	}
}