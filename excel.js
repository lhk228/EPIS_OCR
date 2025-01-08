const express = require('express');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3000;

// 경로 설정
const excelFilePath = path.join(__dirname, 'sample.xlsx');
const outputJsonPath = path.join(__dirname, 'output.json');

// 엑셀 날짜 변환 함수
const convertExcelDate = (excelDate) => {
  const excelEpoch = new Date(1899, 11, 30); // 엑셀 기준 시작 날짜
  const msPerDay = 24 * 60 * 60 * 1000; // 하루의 밀리초 수
  const date = new Date(excelEpoch.getTime() + excelDate * msPerDay); // 날짜 계산
  return date.toISOString().replace('T', ' ').split('.')[0]; // "YYYY-MM-DD HH:mm:ss"
};

// 엑셀 파일을 JSON으로 변환하는 함수
const convertExcelToJson = () => {
  try {
    // 엑셀 파일 읽기
    const workbook = xlsx.readFile(excelFilePath);

    // 첫 번째 시트 이름 가져오기
    const sheetName = workbook.SheetNames[0];

    // 시트 데이터를 JSON으로 변환
    const tmpData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

		// 등록일자 변환
		const jsonData = tmpData.map((row) => {
			if (row.REG_DT) {
				row.REG_DT = convertExcelDate(row.REG_DT); // 날짜 변환 적용
			}
			return row;
		});

    return jsonData;

	} catch (error) {
    console.error('Error converting Excel to JSON:', error);
    return null;
  }
};
// start
app.get('/', (req, res) => {
	res.status(200).send("<div style='color:red'><a href='/convert'>변환</a> <a href='/download'>다운로드</a> </div>");
});



// 라우터 설정
app.get('/convert', (req, res) => {
  const jsonData = convertExcelToJson();

  if (jsonData) {
    res.status(200).json({
      message: 'Excel file converted to JSON successfully.',
      data: jsonData,
    });
  } else {
    res.status(500).json({
      message: 'Failed to convert Excel file to JSON.',
    });
  }
});

// JSON 데이터를 동적으로 다운로드
app.get('/download', (req, res) => {

  let jsonData = convertExcelToJson();

	// JSON 데이터를 문자열로 변환
	const jsonString = JSON.stringify(jsonData, null, 2);

	const jsonFileName = 'sample.json'; // 다운로드될 파일 이름

	// JSON 데이터를 파일로 저장
	fs.writeFileSync(outputJsonPath, JSON.stringify(jsonData, null, 2), 'utf-8');

	res.status(200).json({
		message: 'Excel file converted to JSON successfully.',
	});
});

// 서버 시작
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});